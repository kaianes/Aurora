import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
  YOUTUBE = 'youtube',
}

export enum SocialAccountStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
}

export enum SocialAccountDisconnectReason {
  REVOKED_BY_PLATFORM = 'revoked_by_platform',
  REFRESH_FAILED = 'refresh_failed',
  MANUAL = 'manual',
}

// US-24.1 / ADR-0049. One row per (creator_id, platform) pair (unique;
// relinking a platform overwrites the existing row's tokens rather than
// creating a second one). access/refresh token columns are AES-256-GCM
// ciphertext only, never plaintext, with per-record nonces and a
// token_key_version recording which envelope key encrypted them.
@Entity('creator_social_account')
export class CreatorSocialAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', enum: SocialPlatform })
  platform: SocialPlatform;

  @Column({ type: 'text', name: 'platform_user_id' })
  platformUserId: string;

  @Column({ type: 'text', name: 'platform_handle' })
  platformHandle: string;

  @Column({ type: 'text', enum: SocialAccountStatus, default: SocialAccountStatus.CONNECTED })
  status: SocialAccountStatus;

  @Column({ type: 'text', nullable: true, name: 'disconnect_reason' })
  disconnectReason: SocialAccountDisconnectReason | null;

  @Column({ type: 'text', name: 'access_token_ciphertext' })
  accessTokenCiphertext: string;

  @Column({ type: 'text', name: 'access_token_nonce' })
  accessTokenNonce: string;

  @Column({ type: 'text', nullable: true, name: 'refresh_token_ciphertext' })
  refreshTokenCiphertext: string | null;

  @Column({ type: 'text', nullable: true, name: 'refresh_token_nonce' })
  refreshTokenNonce: string | null;

  @Column({ type: 'int', name: 'token_key_version' })
  tokenKeyVersion: number;

  @Column({ type: 'jsonb', name: 'granted_scope' })
  grantedScope: string[];

  @Column({ type: 'timestamptz', name: 'token_expires_at' })
  tokenExpiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_refreshed_at' })
  lastRefreshedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'connected_at' })
  connectedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'disconnected_at' })
  disconnectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
