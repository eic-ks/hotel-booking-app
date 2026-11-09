DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_key TEXT NOT NULL,
  name TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  checkin TEXT,
  checkout TEXT,
  guests INTEGER NOT NULL DEFAULT 2,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE stay_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_name TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  checkin TEXT,
  checkout TEXT,
  guests INTEGER NOT NULL DEFAULT 2,
  note TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  created_at INTEGER NOT NULL
);
