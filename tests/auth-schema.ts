/** Synthetic Auth records mirror the production cascade structure, never real credentials. */
export const authArtifactSchema=`
alter table auth.users add column encrypted_password text default '',add column confirmation_token text default '';
create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,provider text not null default 'email',identity_data jsonb not null default '{}');
create table auth.one_time_tokens(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,token_hash text not null default 'test-only-hash');
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,secret text not null default 'test-only');
create table auth.mfa_challenges(id uuid primary key default gen_random_uuid(),factor_id uuid not null references auth.mfa_factors(id) on delete cascade);
-- Auth legacy refresh tokens can have no session. PKCE flow state has no user FK.
create table auth.refresh_tokens(id bigint generated always as identity primary key,user_id varchar(255),session_id uuid references auth.sessions(id) on delete cascade,token text not null default 'test-only');
create table auth.flow_state(id uuid primary key default gen_random_uuid(),user_id uuid,provider_access_token text default 'test-only',created_at timestamptz default now());
`;
