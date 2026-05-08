-- ═══════════════════════════════════════════════════════════════
-- AT THE PARK — COMPLETE DATABASE SCHEMA
-- Run with: node src/db/migrate.js
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy search

-- ── CITIES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  country     VARCHAR(100) NOT NULL DEFAULT 'UAE',
  timezone    VARCHAR(50)  NOT NULL DEFAULT 'Asia/Dubai',
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── MEMBERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_number     VARCHAR(20) UNIQUE NOT NULL, -- ATP-00001
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  phone             VARCHAR(30)  UNIQUE,
  password_hash     VARCHAR(255),               -- null for social/magic link only
  avatar_url        VARCHAR(500),
  avatar_gallery    JSONB        DEFAULT '[]',  -- array of photo URLs
  date_of_birth     DATE,
  gender            VARCHAR(20),                -- male, female, non-binary, prefer_not_to_say
  nationality       VARCHAR(100),
  city_id           UUID REFERENCES cities(id),
  tribe_id          UUID,                       -- FK added below after tribes table exists
  subscription_type VARCHAR(20)  NOT NULL DEFAULT 'free', -- free, premium
  subscription_ends TIMESTAMPTZ,
  sports_preferences JSONB       DEFAULT '[]',  -- array of sport names
  top_size          VARCHAR(10),
  bottom_size       VARCHAR(10),
  padel_level       VARCHAR(20),                -- beginner, intermediate, advanced, professional
  profile_complete_pct SMALLINT  NOT NULL DEFAULT 0,
  points_balance    INTEGER      NOT NULL DEFAULT 0,
  is_ambassador     BOOLEAN      NOT NULL DEFAULT false,
  ambassador_activated_at TIMESTAMPTZ,
  ambassador_activated_by UUID,
  is_admin          BOOLEAN      NOT NULL DEFAULT false,
  is_banned         BOOLEAN      NOT NULL DEFAULT false,
  banned_reason     TEXT,
  banned_at         TIMESTAMPTZ,
  email_verified    BOOLEAN      NOT NULL DEFAULT false,
  joined_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ,
  migrated_from_csv BOOLEAN      NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_members_email      ON members(email);
CREATE INDEX idx_members_phone      ON members(phone);
CREATE INDEX idx_members_city       ON members(city_id);
CREATE INDEX idx_members_ambassador ON members(is_ambassador) WHERE is_ambassador = true;
CREATE INDEX idx_members_name_trgm  ON members USING gin((first_name || ' ' || last_name) gin_trgm_ops);

-- ── AUTH TOKENS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  type        VARCHAR(30)  NOT NULL, -- magic_link, refresh, password_reset
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_tokens_hash      ON auth_tokens(token_hash);
CREATE INDEX idx_auth_tokens_member    ON auth_tokens(member_id);
CREATE INDEX idx_auth_tokens_expires   ON auth_tokens(expires_at);

-- ── SOCIAL AUTH ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_accounts (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider     VARCHAR(20)  NOT NULL, -- google, apple, whatsapp
  provider_id  VARCHAR(255) NOT NULL,
  email        VARCHAR(255),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

-- ── TRIBES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tribes (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50)  NOT NULL, -- Better, Faster, Stronger
  slug        VARCHAR(50)  NOT NULL UNIQUE,
  description TEXT,
  color       VARCHAR(7),
  icon        VARCHAR(50),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- members.tribe_id FK + index — declared inline above as bare UUID because
-- tribes is declared after members. Fresh deploys add the FK here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'members_tribe_id_fkey'
  ) THEN
    ALTER TABLE members
      ADD CONSTRAINT members_tribe_id_fkey
      FOREIGN KEY (tribe_id) REFERENCES tribes(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_members_tribe ON members(tribe_id) WHERE tribe_id IS NOT NULL;

-- ── SESSIONS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(200) NOT NULL,
  slug            VARCHAR(200),
  tribe_id        UUID        REFERENCES tribes(id),
  city_id         UUID        NOT NULL REFERENCES cities(id),
  description     TEXT,
  coach_id        UUID        REFERENCES members(id),
  location        VARCHAR(300) NOT NULL,
  location_maps_url VARCHAR(500),
  session_type    VARCHAR(20)  NOT NULL DEFAULT 'free', -- free, paid
  price           DECIMAL(10,2) DEFAULT 0,
  capacity        INTEGER,
  is_recurring    BOOLEAN      NOT NULL DEFAULT false,
  recurrence_rule VARCHAR(100),               -- RRULE format
  scheduled_at    TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ,
  duration_mins   INTEGER      NOT NULL DEFAULT 60,
  points_reward   INTEGER      NOT NULL DEFAULT 10,
  status          VARCHAR(20)  NOT NULL DEFAULT 'upcoming', -- upcoming, live, completed, cancelled
  completed_at    TIMESTAMPTZ,
  is_live_enabled BOOLEAN      NOT NULL DEFAULT false,
  live_stream_url VARCHAR(500),
  live_operator_id UUID        REFERENCES members(id),
  sponsor_id      UUID,                       -- FK to sponsors table
  created_by      UUID        NOT NULL REFERENCES members(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_city       ON sessions(city_id);
CREATE INDEX idx_sessions_tribe      ON sessions(tribe_id);
CREATE INDEX idx_sessions_scheduled  ON sessions(scheduled_at);
CREATE INDEX idx_sessions_status     ON sessions(status);
CREATE INDEX idx_sessions_coach      ON sessions(coach_id);

-- ── BOOKINGS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_id    UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  qr_code       TEXT        NOT NULL,          -- JSON payload for scanner
  qr_token      VARCHAR(100) NOT NULL UNIQUE,  -- short unique token
  status        VARCHAR(20)  NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled, attended, no_show
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID        REFERENCES members(id), -- ambassador who scanned
  check_in_method VARCHAR(20),                 -- qr_scan, manual, admin
  points_awarded INTEGER     DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, session_id)
);

CREATE INDEX idx_bookings_member   ON bookings(member_id);
CREATE INDEX idx_bookings_session  ON bookings(session_id);
CREATE INDEX idx_bookings_status   ON bookings(status);
CREATE INDEX idx_bookings_qr_token ON bookings(qr_token);

-- ── WAITING LIST ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waiting_list (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_id  UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position    INTEGER     NOT NULL,
  notified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,  -- 24h to confirm after notification
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, session_id)
);

-- ── POINTS LEDGER ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_ledger (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount      INTEGER     NOT NULL,            -- positive = earn, negative = spend
  balance     INTEGER     NOT NULL,            -- running balance after this tx
  reason      VARCHAR(50)  NOT NULL,           -- session_checkin, referral, anniversary, challenge, purchase, admin, redemption, expiry
  reference_id UUID,                           -- booking_id, challenge_id, order_id etc
  description TEXT,
  expires_at  TIMESTAMPTZ,                     -- 12 months from earn date
  expired_at  TIMESTAMPTZ,
  created_by  UUID        REFERENCES members(id), -- null = system, admin_id = manual
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_points_member    ON points_ledger(member_id);
CREATE INDEX idx_points_reason    ON points_ledger(reason);
CREATE INDEX idx_points_expires   ON points_ledger(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_points_created   ON points_ledger(created_at);

-- ── REFERRALS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id     UUID        NOT NULL REFERENCES members(id),
  referred_id     UUID        NOT NULL REFERENCES members(id),
  referral_code   VARCHAR(30)  NOT NULL,
  points_awarded  BOOLEAN      NOT NULL DEFAULT false,
  points_awarded_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(referred_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

-- ── CHALLENGES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  icon            VARCHAR(10),
  challenge_type  VARCHAR(20)  NOT NULL, -- weekly, monthly
  metric          VARCHAR(50)  NOT NULL, -- sessions, calories, km, steps, streak_days
  target          INTEGER      NOT NULL,
  unit            VARCHAR(30)  NOT NULL,
  points_reward   INTEGER      NOT NULL DEFAULT 0,
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ  NOT NULL,
  city_id         UUID        REFERENCES cities(id), -- null = global
  tribe_id        UUID        REFERENCES tribes(id), -- null = all tribes
  sponsor_id      UUID,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_by      UUID        NOT NULL REFERENCES members(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_challenges_active ON challenges(is_active, ends_at);

-- ── CHALLENGE PARTICIPANTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_participants (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id  UUID        NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  member_id     UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  progress      INTEGER     NOT NULL DEFAULT 0,
  completed     BOOLEAN     NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  points_awarded BOOLEAN    NOT NULL DEFAULT false,
  joined_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, member_id)
);

CREATE INDEX idx_challenge_participants_member    ON challenge_participants(member_id);
CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id);

-- ── COMMUNITY POSTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content      TEXT,
  media        JSONB        DEFAULT '[]', -- [{url, type: image|video, thumbnail}]
  likes_count  INTEGER     NOT NULL DEFAULT 0,
  comments_count INTEGER   NOT NULL DEFAULT 0,
  is_deleted   BOOLEAN     NOT NULL DEFAULT false,
  deleted_by   UUID        REFERENCES members(id),
  deleted_at   TIMESTAMPTZ,
  report_count INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_member  ON posts(member_id);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE is_deleted = false;

-- ── POST LIKES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, member_id)
);

-- ── COMMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id      UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  member_id    UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  parent_id    UUID        REFERENCES comments(id) ON DELETE CASCADE, -- for replies
  content      TEXT        NOT NULL,
  likes_count  INTEGER     NOT NULL DEFAULT 0,
  is_deleted   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post   ON comments(post_id) WHERE is_deleted = false;
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- ── DIRECT MESSAGES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_a    UUID        NOT NULL REFERENCES members(id),
  member_b    UUID        NOT NULL REFERENCES members(id),
  last_message_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(member_a, member_b),
  CHECK (member_a < member_b) -- enforce consistent ordering
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES members(id),
  content         TEXT        NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type        VARCHAR(50)  NOT NULL, -- session_reminder, streak, challenge, friend_request, points_expiry, etc
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  data        JSONB        DEFAULT '{}',
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_member  ON notifications(member_id, created_at DESC);
CREATE INDEX idx_notifications_unread  ON notifications(member_id) WHERE read_at IS NULL;

-- ── FRIENDSHIPS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id  UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  addressee_id  UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending, accepted, declined, blocked
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

CREATE INDEX idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX idx_friendships_requester ON friendships(requester_id);

-- ── REPORTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id   UUID        NOT NULL REFERENCES members(id),
  target_type   VARCHAR(20)  NOT NULL, -- post, comment, member
  target_id     UUID        NOT NULL,
  reason        VARCHAR(100) NOT NULL,
  description   TEXT,
  resolved      BOOLEAN      NOT NULL DEFAULT false,
  resolved_by   UUID        REFERENCES members(id),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SPONSORS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsors (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(200) NOT NULL,
  logo_url      VARCHAR(500),
  website_url   VARCHAR(500),
  contact_email VARCHAR(255),
  contact_name  VARCHAR(200),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  portal_email  VARCHAR(255) UNIQUE,
  portal_password_hash VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SPONSOR PLACEMENTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsor_placements (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  sponsor_id    UUID        NOT NULL REFERENCES sponsors(id),
  placement_type VARCHAR(50) NOT NULL, -- session, challenge, feed_banner, homepage
  reference_id  UUID,                  -- session_id or challenge_id
  banner_url    VARCHAR(500),
  click_url     VARCHAR(500),
  impressions   INTEGER     NOT NULL DEFAULT 0,
  clicks        INTEGER     NOT NULL DEFAULT 0,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SESSION FEEDBACK ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_feedback (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  points_awarded BOOLEAN  NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, member_id)
);

CREATE INDEX idx_feedback_session ON session_feedback(session_id);
CREATE INDEX idx_feedback_member  ON session_feedback(member_id);

-- ── CMS CONTENT ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_content (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  page         VARCHAR(50)  NOT NULL, -- index, sessions, store, community, about
  section      VARCHAR(100) NOT NULL, -- hero, story, partners, etc
  key          VARCHAR(100) NOT NULL,
  value_text   TEXT,
  value_url    VARCHAR(500),
  value_json   JSONB,
  updated_by   UUID        REFERENCES members(id),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(page, section, key)
);

-- ── PUSH NOTIFICATION TOKENS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token       VARCHAR(500) NOT NULL UNIQUE,
  platform    VARCHAR(20)  NOT NULL, -- ios, android, web
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── POINTS CONFIG ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_config (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  action      VARCHAR(50)  NOT NULL UNIQUE, -- session_checkin, referral, anniversary, feedback, profile_complete
  points      INTEGER      NOT NULL,
  description TEXT,
  updated_by  UUID        REFERENCES members(id),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── SEED: DEFAULT DATA ────────────────────────────────────────

-- Cities
INSERT INTO cities (name, country, timezone) VALUES
  ('Dubai',  'UAE', 'Asia/Dubai'),
  ('Al Ain', 'UAE', 'Asia/Dubai'),
  ('Muscat', 'Oman', 'Asia/Muscat')
ON CONFLICT DO NOTHING;

-- Tribes
INSERT INTO tribes (name, slug, description, color) VALUES
  ('Better',   'better',   'Yoga, pilates, sound healing, mindfulness', '#4ade80'),
  ('Faster',   'faster',   'Running, cycling, swimming, endurance',      '#60a5fa'),
  ('Stronger', 'stronger', 'Bootcamp, kickboxing, CrossTraining, HIIT',  '#f97316')
ON CONFLICT DO NOTHING;

-- Points config defaults
INSERT INTO points_config (action, points, description) VALUES
  ('session_checkin',   10,  'Points awarded per session attendance'),
  ('referral',          50,  'Points when referred member completes first check-in'),
  ('anniversary',       200, 'Annual membership anniversary bonus'),
  ('feedback',          5,   'Points for submitting post-session feedback'),
  ('profile_complete',  100, 'One-time reward for 100% complete profile'),
  ('virtual_checkin',   5,   'Points for attending a session via ATP Live')
ON CONFLICT DO NOTHING;
