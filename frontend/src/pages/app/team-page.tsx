import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { invitationApi, memberApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageTeam, getInvitableRoles, ROLE_LABELS } from '@/lib/roles';
import type { Role } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const inviteSchema = z.object({
  email: z.string().email('Email invalido'),
  role: z.string().min(1, 'Selecione um papel'),
});

type InviteForm = z.infer<typeof inviteSchema>;

export function TeamPage() {
  const { workspace, currentRole, user } = useAuth();
  const queryClient = useQueryClient();
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const accountId = workspace?.current_account?.id ?? '';
  const workspaceType = workspace?.workspace?.type ?? 'brand';
  const isManager = currentRole ? canManageTeam(currentRole) : false;

  const { data: membersData, isLoading: loadingMembers } = useQuery({
    queryKey: ['members', accountId],
    queryFn: () => memberApi.list(accountId),
    enabled: !!accountId,
  });

  const { data: invitationsData, isLoading: loadingInvitations } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => invitationApi.list({ status: 'pending' }),
    enabled: isManager,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: '' },
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteForm) =>
      invitationApi.create({ email: data.email, role: data.role as Role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      reset();
      setInviteSuccess(true);
      setTimeout(() => setInviteSuccess(false), 3000);
    },
  });

  const resendMutation = useMutation({
    mutationFn: invitationApi.resend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: invitationApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => memberApi.remove(accountId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', accountId] });
    },
  });

  const roleChangeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      memberApi.updateRole(accountId, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', accountId] });
    },
  });

  const inviteError = inviteMutation.error;
  const inviteErrorMessage =
    inviteError && isAxiosError(inviteError) && inviteError.response?.data?.error?.message
      ? inviteError.response.data.error.message
      : inviteError
        ? 'Nao foi possivel enviar o convite.'
        : null;

  const invitableRoles = getInvitableRoles(workspaceType);
  const roleOptions = invitableRoles.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  if (loadingMembers) {
    return <Spinner />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <CardTitle>Equipe</CardTitle>
        <CardDescription>Gerencie os membros e convites do workspace.</CardDescription>
      </CardHeader>

      {/* Invite form (owner/admin only) */}
      {isManager && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Convidar membro</h3>

          {inviteSuccess && (
            <Alert variant="success" className="mb-3">Convite enviado com sucesso.</Alert>
          )}
          {inviteErrorMessage && (
            <Alert variant="error" className="mb-3">{inviteErrorMessage}</Alert>
          )}

          <form
            onSubmit={handleSubmit((data) => inviteMutation.mutate(data))}
            noValidate
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="flex-1">
              <Input
                placeholder="email@exemplo.com"
                type="email"
                {...register('email')}
                error={errors.email?.message}
                aria-label="Email do convidado"
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                options={roleOptions}
                placeholder="Selecione o papel"
                {...register('role')}
                error={errors.role?.message}
                aria-label="Papel do convidado"
              />
            </div>
            <Button type="submit" loading={inviteMutation.isPending}>
              Convidar
            </Button>
          </form>
        </Card>
      )}

      {/* Members list */}
      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Membros</h3>
        {membersData?.data && membersData.data.length > 0 ? (
          <div className="divide-y divide-border">
            {membersData.data.map((member) => (
              <div key={member.user_id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-text-dark">{member.name}</p>
                  <p className="text-xs text-muted">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isManager && member.user_id !== user?.id ? (
                    <select
                      value={member.role}
                      onChange={(e) =>
                        roleChangeMutation.mutate({ userId: member.user_id, role: e.target.value as Role })
                      }
                      className="rounded border border-border px-2 py-1 text-xs"
                      aria-label={`Papel de ${member.name}`}
                    >
                      {/* Show current role + invitable roles */}
                      <option value={member.role}>{ROLE_LABELS[member.role]}</option>
                      {invitableRoles
                        .filter((r) => r !== member.role)
                        .map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                    </select>
                  ) : (
                    <Badge variant="primary">{ROLE_LABELS[member.role]}</Badge>
                  )}
                  {isManager && member.user_id !== user?.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('Tem certeza que deseja remover este membro?')) {
                          removeMemberMutation.mutate(member.user_id);
                        }
                      }}
                      className="text-error hover:text-error/80"
                    >
                      Remover
                    </Button>
                  )}
                  <span className="text-xs text-muted font-mono">
                    {new Date(member.joined_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted py-4 text-center">Nenhum membro encontrado.</p>
        )}
      </Card>

      {/* Pending invitations */}
      {isManager && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Convites pendentes</h3>
          {loadingInvitations ? (
            <Spinner className="h-5 w-5" />
          ) : invitationsData?.data && invitationsData.data.length > 0 ? (
            <div className="divide-y divide-border">
              {invitationsData.data.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm text-text-dark">{inv.email}</p>
                    <p className="text-xs text-muted">
                      {ROLE_LABELS[inv.role]} &middot; Expira em{' '}
                      <span className="font-mono">
                        {new Date(inv.expires_at).toLocaleDateString('pt-BR')}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resendMutation.mutate(inv.id)}
                      loading={resendMutation.isPending}
                    >
                      Reenviar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelMutation.mutate(inv.id)}
                      className="text-error"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-4 text-center">Nenhum convite pendente.</p>
          )}
        </Card>
      )}

      {roleChangeMutation.error && (
        <Alert variant="error">
          {isAxiosError(roleChangeMutation.error) && roleChangeMutation.error.response?.data?.error?.message
            ? roleChangeMutation.error.response.data.error.message
            : 'Nao foi possivel alterar o papel do membro.'}
        </Alert>
      )}
      {removeMemberMutation.error && (
        <Alert variant="error">
          {isAxiosError(removeMemberMutation.error) && removeMemberMutation.error.response?.data?.error?.message
            ? removeMemberMutation.error.response.data.error.message
            : 'Nao foi possivel remover o membro.'}
        </Alert>
      )}
    </div>
  );
}
