// Drizzle schema for the hotel search space.
//
// Three user-owned tables:
// - favorites: hotel snapshots the user saved from search results
// - search_history: past destination searches (re-runnable)
// - stay_plans: booking memos (hotel, dates, guests, note) the user keeps
// Hotel search results themselves are live data fetched per search and are
// never persisted as inventory.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const favorites = sqliteTable("favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Normalized "name|destination" key for dedupe.
  hotelKey: text("hotel_key").notNull(),
  name: text("name").notNull(),
  destinationLabel: text("destination_label").notNull(),
  // JSON snapshot of the hotel result at save time.
  data: text("data").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const searchHistory = sqliteTable("search_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  mode: text("mode", { enum: ["pinpoint", "area"] }).notNull(),
  checkin: text("checkin"),
  checkout: text("checkout"),
  guests: integer("guests").notNull().default(2),
  resultCount: integer("result_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const stayPlans = sqliteTable("stay_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hotelName: text("hotel_name").notNull(),
  destinationLabel: text("destination_label").notNull(),
  checkin: text("checkin"),
  checkout: text("checkout"),
  guests: integer("guests").notNull().default(2),
  note: text("note").notNull().default(""),
  sourceUrl: text("source_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
