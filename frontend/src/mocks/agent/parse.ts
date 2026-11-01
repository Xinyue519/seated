import type { CuisineGroup, DayWord, Entities, PriceLevel } from '@/types';
import { allRestaurants } from '@/data/restaurants';

/**
 * Keyword-based stand-in for the LLM "intent understanding" step.
 * The real backend returns the same `Entities` shape from OpenAI tool calling.
 */

const CUISINE_KEYWORDS: Array<[string, CuisineGroup]> = [
  ['italian', 'italian'], ['pasta', 'italian'], ['tuscan', 'italian'],
  ['pizza', 'pizza'],
  ['french', 'french'], ['bistro', 'french'], ['brasserie', 'french'],
  ['sushi', 'japanese'], ['omakase', 'japanese'], ['japanese', 'japanese'], ['ramen', 'japanese'], ['noodle', 'japanese'],
  ['mexican', 'mexican'], ['taco', 'mexican'],
  ['korean', 'korean'],
  ['thai', 'thai'],
  ['deli', 'deli'], ['pastrami', 'deli'], ['sandwich', 'deli'],
  ['american', 'american'],
  ['vegetarian', 'vegetarian'], ['vegan', 'vegetarian'], ['plant', 'vegetarian'],
];

const NEIGHBORHOOD_ALIASES: Array<[string, string]> = [
  ['west village', 'West Village'],
  ['greenwich village', 'Greenwich Village'],
  ['the village', 'West Village'],
  ['soho', 'SoHo'],
  ['nolita', 'Nolita'],
  ['tribeca', 'Tribeca'],
  ['east village', 'East Village'],
  ['lower east side', 'Lower East Side'],
  ['les', 'Lower East Side'],
  ['flatiron', 'Flatiron'],
  ['nomad', 'NoMad'],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const CUISINE_WORDS = new Set(CUISINE_KEYWORDS.map(([k]) => k));

export const normalize = (s: string) =>
  s.toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim();

export function parseMessage(raw: string): Entities {
  const t = ` ${normalize(raw)} `;
  const e: Entities = { raw: t };

  e.cuisine = CUISINE_KEYWORDS.find(([k]) => t.includes(k))?.[1];
  e.neighborhood = NEIGHBORHOOD_ALIASES.find(([k]) => new RegExp(`\\b${k}\\b`).test(t))?.[1];

  e.reference = allRestaurants().find((r) => {
    const name = normalize(r.name);
    const first = name.split(' ')[0];
    return t.includes(name) || (first.length > 4 && !CUISINE_WORDS.has(first) && t.includes(` ${first} `));
  });

  if (/(similar|like|same vibe|such as|feel of)/.test(t)) e.similar = true;
  if (/(not .*saved|havent|have not|never been|new to me|not somewhere)/.test(t)) e.excludeSaved = true;
  if (/(my saved|saved places|my collection|my list)/.test(t)) e.likeSaved = true;
  if (/(from my saved|one of these|saved list|one of my saved)/.test(t)) e.onlySaved = true;

  const party =
    t.match(/(\d+|one|two|three|four|five|six|seven|eight)\s*(people|guests|persons|ppl|of us|pax)/) ??
    t.match(/(?:for|party of|table for)\s+(\d+|one|two|three|four|five|six|seven|eight)\b(?!\s*(pm|am|:))/) ??
    t.match(/^\s*(\d)\s*$/);
  if (party) e.partySize = NUMBER_WORDS[party[1]] ?? parseInt(party[1], 10);
  if (/\b(just me|solo)\b/.test(t)) e.partySize = 1;
  if (!e.partySize && /\b(date|two of us)\b/.test(t)) e.partySize = 2;

  const time =
    t.match(/(\d{1,2})(?::(\d{2}))?\s*(pm|am)\b/) ?? t.match(/\bat (\d{1,2}):(\d{2})\b/) ?? t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (time) {
    let h = parseInt(time[1], 10);
    if (h > 12) h -= 12;
    e.time = `${h}:${time[2] ?? '00'}`;
  }

  const day = t.match(/\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b/);
  if (day) e.day = (day[1] === 'tonight' ? 'today' : day[1]) as DayWord;

  if (/(cheap|budget|inexpensive|affordable|cheaper)/.test(t)) e.maxPrice = 2 as PriceLevel;
  if (/(fancy|splurge|special|upscale|anniversary|celebrat)/.test(t)) e.minPrice = 3 as PriceLevel;
  if (/(vegetarian|vegan|plant)/.test(t)) e.vegetarian = true;

  return e;
}

export type Intent =
  | 'cancel'
  | 'modify'
  | 'list_reservations'
  | 'more'
  | 'cheaper'
  | 'book'
  | 'discover'
  | 'unknown';

export function classifyIntent(e: Entities, hasLastSearch: boolean): Intent {
  const t = e.raw;
  if (/\bcancel\b/.test(t)) return 'cancel';
  if (/(change|move|modify|reschedule)/.test(t)) return 'modify';
  if (/(my reservations|my bookings|what.*booked|upcoming)/.test(t)) return 'list_reservations';
  if (hasLastSearch && /(more options|show more|other options|anything else)/.test(t)) return 'more';
  if (hasLastSearch && /cheaper/.test(t)) return 'cheaper';
  if (e.reference && !e.similar && /(book|reserve|table at|get us into|get me into)/.test(t)) return 'book';
  if (
    e.cuisine || e.neighborhood || e.reference || e.vegetarian || e.maxPrice || e.minPrice || e.likeSaved || e.onlySaved ||
    /(dinner|lunch|brunch|eat|food|restaurant|somewhere|place|spot|table|hungry|recommend)/.test(t)
  )
    return 'discover';
  return 'unknown';
}
