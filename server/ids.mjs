export function newId() {
  const stamp = Date.now().toString();
  const extra = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${stamp}${extra}`.slice(-15);
}

export function slugify(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.slice(0, 80) || 'company';
}
