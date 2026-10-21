import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { safetyRulesetApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageSafetyRules } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { CompetitorMentionDefinition, ProhibitedTopicDefinition, RestrictedLanguageDefinition, SafetyRule, SafetyRuleType } from '@/types/api';

const RULE_TYPE_LABEL: Record<SafetyRuleType, string> = {
  prohibited_topic: 'Topicos proibidos',
  restricted_language: 'Linguagem restrita',
  competitor_mention: 'Mencao a concorrentes',
};

const RULE_TYPES: SafetyRuleType[] = ['prohibited_topic', 'restricted_language', 'competitor_mention'];

function ruleSummary(rule: SafetyRule): string {
  if (rule.rule_type === 'prohibited_topic') {
    return (rule.definition as ProhibitedTopicDefinition | null)?.topic ?? '';
  }
  if (rule.rule_type === 'restricted_language') {
    const def = rule.definition as RestrictedLanguageDefinition | null;
    return `${def?.pattern ?? ''} (${def?.pattern_type === 'regex' ? 'expressao regular' : 'palavra-chave'})`;
  }
  const def = rule.definition as CompetitorMentionDefinition | null;
  const aliases = def?.aliases?.length ? ` (${def.aliases.join(', ')})` : '';
  return `${def?.competitor_name ?? ''}${aliases}`;
}

interface RuleTypeFormProps {
  ruleType: SafetyRuleType;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (definition: Record<string, unknown>) => void;
}

/**
 * Create form for one rule_type, matching the definition shape in
 * docs/architecture/e4-brand-safety.md section 2.3. Each rule_type's form is independent of
 * the others, so a malformed submission here never touches the rest of the ruleset.
 */
function RuleTypeForm({ ruleType, submitting, onCancel, onSubmit }: RuleTypeFormProps) {
  const [topic, setTopic] = useState('');
  const [pattern, setPattern] = useState('');
  const [patternType, setPatternType] = useState<'keyword' | 'regex'>('keyword');
  const [competitorName, setCompetitorName] = useState('');
  const [aliases, setAliases] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ruleType === 'prohibited_topic') {
      onSubmit({ topic });
    } else if (ruleType === 'restricted_language') {
      onSubmit({ pattern, pattern_type: patternType });
    } else {
      onSubmit({
        competitor_name: competitorName,
        aliases: aliases.trim() ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : undefined,
      });
    }
  };

  const canSubmit =
    ruleType === 'prohibited_topic'
      ? topic.trim().length > 0
      : ruleType === 'restricted_language'
        ? pattern.trim().length > 0
        : competitorName.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {ruleType === 'prohibited_topic' && (
        <Input
          label="Topico proibido"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          hint="2 a 200 caracteres"
        />
      )}
      {ruleType === 'restricted_language' && (
        <>
          <Input
            label="Padrao"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            hint="Palavra-chave ou expressao regular, 1 a 500 caracteres"
          />
          <Select
            label="Tipo de padrao"
            value={patternType}
            onChange={(e) => setPatternType(e.target.value as 'keyword' | 'regex')}
            options={[
              { value: 'keyword', label: 'Palavra-chave' },
              { value: 'regex', label: 'Expressao regular' },
            ]}
          />
        </>
      )}
      {ruleType === 'competitor_mention' && (
        <>
          <Input
            label="Nome do concorrente"
            value={competitorName}
            onChange={(e) => setCompetitorName(e.target.value)}
            hint="2 a 200 caracteres"
          />
          <Input
            label="Variacoes/alias (separados por virgula)"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={submitting} disabled={!canSubmit}>
          Adicionar
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Brand-level safety ruleset editor (US-15 scenario 1). Rules are saved one at a time via the
 * single-rule endpoints: each create/update/delete is its own atomic request, so a malformed
 * rule's rejection (scenario 3) never affects any other rule already in the ruleset -- there is
 * simply nothing else in that request to roll back.
 */
export function SafetyRulesetPage() {
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canManage = currentRole ? canManageSafetyRules(currentRole) : false;
  const [openForm, setOpenForm] = useState<SafetyRuleType | null>(null);
  const [formErrors, setFormErrors] = useState<Partial<Record<SafetyRuleType, string>>>({});
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);

  const { data: ruleset, isLoading, error } = useQuery({
    queryKey: ['safety-ruleset-brand'],
    queryFn: () => safetyRulesetApi.getBrand(),
  });

  const createMutation = useMutation({
    mutationFn: (vars: { ruleType: SafetyRuleType; definition: Record<string, unknown> }) =>
      safetyRulesetApi.createBrandRule({ rule_type: vars.ruleType, definition: vars.definition as never }),
    onSuccess: (_data, vars) => {
      setFormErrors((prev) => ({ ...prev, [vars.ruleType]: undefined }));
      setOpenForm(null);
      queryClient.invalidateQueries({ queryKey: ['safety-ruleset-brand'] });
    },
    onError: (err, vars) => {
      const message =
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel salvar a regra. Verifique os dados informados.';
      setFormErrors((prev) => ({ ...prev, [vars.ruleType]: message }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => safetyRulesetApi.deleteBrandRule(ruleId),
    onSuccess: (data) => {
      setDeleteWarning(
        data.affected_campaign_overrides && data.affected_campaign_overrides.length > 0
          ? `Esta regra era referenciada por overrides de campanha que agora ficaram sem efeito: ${data.affected_campaign_overrides.join(', ')}.`
          : null,
      );
      queryClient.invalidateQueries({ queryKey: ['safety-ruleset-brand'] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar o conjunto de regras da marca.</Alert>;

  const rulesByType = (type: SafetyRuleType) => ruleset?.rules.filter((r) => r.rule_type === type) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <CardTitle>Regras de seguranca da marca</CardTitle>
        <CardDescription>
          Essas regras sao aplicadas automaticamente a toda nova campanha, sem nenhuma etapa extra por campanha.
        </CardDescription>
      </CardHeader>

      {deleteWarning && <Alert variant="warning">{deleteWarning}</Alert>}

      {RULE_TYPES.map((type) => (
        <Card key={type}>
          <h3 className="text-sm font-semibold text-text-dark mb-3">{RULE_TYPE_LABEL[type]}</h3>

          {formErrors[type] && (
            <Alert variant="error" className="mb-3">
              {formErrors[type]}
            </Alert>
          )}

          {rulesByType(type).length > 0 ? (
            <div className="divide-y divide-border mb-3">
              {rulesByType(type).map((rule) => (
                <div key={rule.id} className="flex items-center justify-between py-2 gap-4">
                  <p className="text-sm text-text-dark font-mono min-w-0 break-words">{ruleSummary(rule)}</p>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      loading={deleteMutation.isPending}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-3">Nenhuma regra cadastrada.</p>
          )}

          {canManage &&
            (openForm === type ? (
              <RuleTypeForm
                ruleType={type}
                submitting={createMutation.isPending}
                onCancel={() => setOpenForm(null)}
                onSubmit={(definition) => createMutation.mutate({ ruleType: type, definition })}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setOpenForm(type)}>
                Adicionar regra
              </Button>
            ))}
        </Card>
      ))}
    </div>
  );
}
