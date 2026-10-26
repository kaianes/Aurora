import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { safetyRulesetApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageSafetyRules } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { SafetyRuleAction, SafetyRuleDefinition, SafetyRuleType } from '@/types/api';

const RULE_TYPE_LABEL: Record<SafetyRuleType, string> = {
  prohibited_topic: 'Topico proibido',
  restricted_language: 'Linguagem restrita',
  competitor_mention: 'Mencao a concorrente',
};

const OVERRIDE_ACTION_LABEL: Record<SafetyRuleAction, string> = {
  add: 'Exclusiva desta campanha',
  replace: 'Substitui a regra da marca',
  suppress: 'Suspende a regra da marca',
};

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function ruleDefinitionSummary(ruleType: SafetyRuleType, definition: SafetyRuleDefinition | null): string {
  if (!definition) return 'Suspensa';
  if (ruleType === 'prohibited_topic') return (definition as { topic: string }).topic;
  if (ruleType === 'restricted_language') {
    const def = definition as { pattern: string; pattern_type: 'keyword' | 'regex' };
    return `${def.pattern} (${def.pattern_type === 'regex' ? 'expressao regular' : 'palavra-chave'})`;
  }
  const def = definition as { competitor_name: string; aliases?: string[] };
  const aliases = def.aliases?.length ? ` (${def.aliases.join(', ')})` : '';
  return `${def.competitor_name}${aliases}`;
}

/**
 * Campaign effective-ruleset view (US-15 scenario 2). `has_override` and each rule's `source`
 * come straight from the backend (section 3.2) so "this campaign is running on an override
 * rather than the inherited default" is never left to the frontend to infer.
 */
export function CampaignSafetyRulesetPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canManage = currentRole ? canManageSafetyRules(currentRole) : false;

  const [showForm, setShowForm] = useState(false);
  const [action, setAction] = useState<SafetyRuleAction>('add');
  const [supersedesId, setSupersedesId] = useState('');
  const [ruleType, setRuleType] = useState<SafetyRuleType>('prohibited_topic');
  const [topic, setTopic] = useState('');
  const [pattern, setPattern] = useState('');
  const [patternType, setPatternType] = useState<'keyword' | 'regex'>('keyword');
  const [competitorName, setCompetitorName] = useState('');
  const [aliases, setAliases] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: effective, isLoading, error } = useQuery({
    queryKey: ['campaign-safety-ruleset', id],
    queryFn: () => safetyRulesetApi.getCampaignRuleset(id!),
    enabled: !!id,
  });

  // Brand-scope rules are the only valid supersedes_rule_id targets (section 2.6's constraint).
  const { data: brandRuleset } = useQuery({
    queryKey: ['safety-ruleset-brand'],
    queryFn: () => safetyRulesetApi.getBrand(),
    enabled: canManage,
  });

  const resetFormFields = () => {
    setTopic('');
    setPattern('');
    setCompetitorName('');
    setAliases('');
    setSupersedesId('');
  };

  const overrideMutation = useMutation({
    mutationFn: () => {
      const definition: SafetyRuleDefinition | undefined =
        action === 'suppress'
          ? undefined
          : ruleType === 'prohibited_topic'
            ? { topic }
            : ruleType === 'restricted_language'
              ? { pattern, pattern_type: patternType }
              : {
                  competitor_name: competitorName,
                  aliases: aliases.trim() ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : undefined,
                };
      return safetyRulesetApi.createCampaignOverride(id!, {
        action,
        supersedes_rule_id: action === 'add' ? undefined : supersedesId,
        rule_type: action === 'suppress' ? undefined : ruleType,
        definition,
      });
    },
    onSuccess: () => {
      setFormError(null);
      setShowForm(false);
      resetFormFields();
      queryClient.invalidateQueries({ queryKey: ['campaign-safety-ruleset', id] });
    },
    onError: (err) => {
      setFormError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel salvar o override. Verifique os dados informados.',
      );
    },
  });

  const removeOverrideMutation = useMutation({
    mutationFn: (ruleId: string) => safetyRulesetApi.deleteCampaignOverride(id!, ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaign-safety-ruleset', id] }),
  });

  if (isLoading) return <Spinner />;
  if (error || !effective) {
    return <Alert variant="error">Nao foi possivel carregar as regras de seguranca da campanha.</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <CardTitle>Regras de seguranca da campanha</CardTitle>
        <CardDescription>
          Regras efetivas aplicadas a esta campanha, combinando o padrao da marca com os overrides definidos aqui.
        </CardDescription>
      </CardHeader>

      {effective.has_override ? (
        <Alert variant="warning">
          Esta campanha esta rodando com um override de seguranca -- ela nao usa apenas o padrao herdado da marca.
        </Alert>
      ) : (
        <Alert variant="info">Esta campanha usa o padrao de seguranca herdado da marca, sem overrides.</Alert>
      )}

      <Card>
        <div className="divide-y divide-border">
          {effective.effective_rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between py-3 gap-4">
              <div className="min-w-0">
                <p className="flex items-center font-mono text-sm text-text-dark">
                  <MetricDot
                    color={rule.source === 'brand' ? 'var(--color-strategy-violet)' : 'var(--color-performance-orange)'}
                  />
                  {RULE_TYPE_LABEL[rule.rule_type]}: {ruleDefinitionSummary(rule.rule_type, rule.definition)}
                </p>
                {rule.note && <p className="text-xs text-muted mt-1">{rule.note}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={rule.source === 'brand' ? 'default' : 'primary'}>
                  {rule.source === 'brand' ? 'Padrao da marca' : OVERRIDE_ACTION_LABEL[rule.override_action ?? 'add']}
                </Badge>
                {canManage && rule.source === 'campaign_override' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeOverrideMutation.mutate(rule.id)}
                    loading={removeOverrideMutation.isPending}
                  >
                    Remover override
                  </Button>
                )}
              </div>
            </div>
          ))}
          {effective.effective_rules.length === 0 && (
            <p className="text-sm text-muted py-8 text-center">Nenhuma regra efetiva para esta campanha.</p>
          )}
        </div>
      </Card>

      {canManage && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Override desta campanha</h3>
          {!showForm ? (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              Adicionar override
            </Button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                overrideMutation.mutate();
              }}
              className="space-y-3"
              noValidate
            >
              {formError && <Alert variant="error">{formError}</Alert>}
              <Select
                label="Tipo de override"
                value={action}
                onChange={(e) => setAction(e.target.value as SafetyRuleAction)}
                options={[
                  { value: 'add', label: 'Adicionar regra exclusiva desta campanha' },
                  { value: 'replace', label: 'Substituir uma regra da marca' },
                  { value: 'suppress', label: 'Suspender uma regra da marca' },
                ]}
              />
              {action !== 'add' && (
                <Select
                  label="Regra da marca a referenciar"
                  value={supersedesId}
                  onChange={(e) => setSupersedesId(e.target.value)}
                  placeholder="Selecione a regra da marca"
                  options={(brandRuleset?.rules ?? []).map((r) => ({
                    value: r.id,
                    label: `${RULE_TYPE_LABEL[r.rule_type]}: ${ruleDefinitionSummary(r.rule_type, r.definition)}`,
                  }))}
                />
              )}
              {action !== 'suppress' && (
                <>
                  <Select
                    label="Tipo de regra"
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as SafetyRuleType)}
                    options={[
                      { value: 'prohibited_topic', label: RULE_TYPE_LABEL.prohibited_topic },
                      { value: 'restricted_language', label: RULE_TYPE_LABEL.restricted_language },
                      { value: 'competitor_mention', label: RULE_TYPE_LABEL.competitor_mention },
                    ]}
                  />
                  {ruleType === 'prohibited_topic' && (
                    <Input label="Topico proibido" value={topic} onChange={(e) => setTopic(e.target.value)} />
                  )}
                  {ruleType === 'restricted_language' && (
                    <>
                      <Input label="Padrao" value={pattern} onChange={(e) => setPattern(e.target.value)} />
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
                      />
                      <Input
                        label="Variacoes/alias (separados por virgula)"
                        value={aliases}
                        onChange={(e) => setAliases(e.target.value)}
                      />
                    </>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={overrideMutation.isPending}>
                  Salvar override
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
