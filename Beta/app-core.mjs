const REVIEW_KEYS = ['evidence', 'expectations', 'alternatives', 'uncertainty'];

export function canReveal({ view = '', reasoning = '', falsifier = '' } = {}) {
  return [view, reasoning, falsifier].every((value) => String(value).trim().length > 0);
}

export function scoreSelfReview(ratings = {}) {
  const values = REVIEW_KEYS.map((key) => Number(ratings[key]));
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / REVIEW_KEYS.length) * 20);
}
