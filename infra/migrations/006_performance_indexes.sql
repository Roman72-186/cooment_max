-- Performance indexes for comments polling, notifications, and analytics.

CREATE INDEX IF NOT EXISTS idx_comments_post_visible_id
  ON comments(post_id, id)
  WHERE is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_comments_post_visible_created_id
  ON comments(post_id, created_at, id)
  WHERE is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_post_subscriptions_post_last_notified
  ON post_subscriptions(post_id, last_notified_at);

CREATE INDEX IF NOT EXISTS idx_posts_channel_published_comments
  ON posts(channel_id, published_at DESC, comment_count DESC);

CREATE INDEX IF NOT EXISTS idx_reply_notifications_unsent_created_id
  ON reply_notifications(created_at, id)
  WHERE sent_at IS NULL;
