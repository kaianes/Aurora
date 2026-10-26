import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateCopyService } from './template-copy.service';

function mockQueryRunner() {
  const manager = {
    find: vi.fn(),
    create: vi.fn((_entity: any, data: any) => ({ ...data })),
    save: vi.fn((entity: any) => Promise.resolve({ id: 'copied-tmpl-id', createdAt: new Date(), ...entity })),
  };
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(undefined),
    manager,
  };
}

// US-41 / FR-22, ADR-0060, section 2.2/2.6/4 of the E9 architecture doc.
// The escape-hatch mechanics (SET LOCAL app.agency_template_copy,
// app.current_workspace_id, on a dedicated transaction) and the
// brand_profile_snapshot = null rule are the two load-bearing behaviors
// this class owns; all authorization happens in the caller, before either
// method here is ever invoked.
describe('TemplateCopyService - US-41', () => {
  let service: TemplateCopyService;
  let dataSource: { createQueryRunner: ReturnType<typeof vi.fn> };
  let queryRunner: ReturnType<typeof mockQueryRunner>;

  beforeEach(() => {
    queryRunner = mockQueryRunner();
    dataSource = { createQueryRunner: vi.fn(() => queryRunner) };
    service = new TemplateCopyService(dataSource as any);
  });

  describe('copyAllTemplates (section 4.1, onboarding-time bulk copy)', () => {
    it('sets the escape-hatch flags and copies every source template, always nulling brand_profile_snapshot', async () => {
      queryRunner.manager.find.mockResolvedValue([
        {
          id: 'tmpl-1',
          name: 'Lancamento padrao',
          audienceTargeting: { geography: ['BR-SP'] },
          message: 'Brief',
          deliverableFormats: ['instagram_reel'],
          timelineShape: { duration_days: 29 },
          brandProfileSnapshot: { prohibited_topics: ['tabaco'], tone_of_voice: 'casual' },
        },
        {
          id: 'tmpl-2',
          name: 'Modelo 2',
          audienceTargeting: null,
          message: null,
          deliverableFormats: null,
          timelineShape: null,
          brandProfileSnapshot: null,
        },
      ]);

      const count = await service.copyAllTemplates('source-acct', 'target-acct', 'ws-1');

      expect(queryRunner.query).toHaveBeenCalledWith(`SET LOCAL app.agency_template_copy = 'true'`);
      expect(queryRunner.query).toHaveBeenCalledWith(`SET LOCAL app.current_workspace_id = $1`, ['ws-1']);
      expect(count).toBe(2);
      expect(queryRunner.manager.save).toHaveBeenCalledTimes(2);

      const firstSaved = queryRunner.manager.create.mock.calls[0][1];
      expect(firstSaved.accountId).toBe('target-acct');
      expect(firstSaved.sourceCampaignId).toBeNull();
      expect(firstSaved.copiedFromTemplateId).toBe('tmpl-1');
      // ADR-0060: brand_profile_snapshot is always null on a cross-client
      // copy, regardless of what the source template carried.
      expect(firstSaved.brandProfileSnapshot).toBeNull();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('returns 0 and copies nothing when the source account has no templates', async () => {
      queryRunner.manager.find.mockResolvedValue([]);

      const count = await service.copyAllTemplates('source-acct', 'target-acct', 'ws-1');

      expect(count).toBe(0);
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('rolls back the transaction and releases the connection when a copy fails', async () => {
      queryRunner.manager.find.mockRejectedValue(new Error('db down'));

      await expect(service.copyAllTemplates('source-acct', 'target-acct', 'ws-1')).rejects.toThrow('db down');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('copyOne (section 4.2, the ongoing copy action)', () => {
    it('copies exactly one already-loaded source template under the target account, with brand_profile_snapshot null', async () => {
      const source = {
        id: 'tmpl-source',
        name: 'Lancamento de produto - padrao',
        audienceTargeting: { geography: ['BR-SP'] },
        message: 'Destacar vitamina C',
        deliverableFormats: ['instagram_reel', 'instagram_story'],
        timelineShape: { duration_days: 29 },
        brandProfileSnapshot: { prohibited_topics: [], tone_of_voice: 'formal' },
      };

      const result = await service.copyOne(source as any, 'target-acct', 'ws-1');

      expect(queryRunner.query).toHaveBeenCalledWith(`SET LOCAL app.agency_template_copy = 'true'`);
      expect(queryRunner.query).toHaveBeenCalledWith(`SET LOCAL app.current_workspace_id = $1`, ['ws-1']);
      const created = queryRunner.manager.create.mock.calls[0][1];
      expect(created.accountId).toBe('target-acct');
      expect(created.copiedFromTemplateId).toBe('tmpl-source');
      expect(created.sourceCampaignId).toBeNull();
      expect(created.brandProfileSnapshot).toBeNull();
      expect(created.name).toBe('Lancamento de produto - padrao');
      expect(result.id).toBe('copied-tmpl-id');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('rolls back and releases on failure', async () => {
      queryRunner.manager.save.mockRejectedValue(new Error('constraint violation'));

      await expect(
        service.copyOne({ id: 'tmpl-1' } as any, 'target-acct', 'ws-1'),
      ).rejects.toThrow('constraint violation');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });
});
