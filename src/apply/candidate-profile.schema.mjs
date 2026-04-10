export const REQUIRED_FIELDS = [
  'first_name', 'last_name', 'email', 'phone',
  'linkedin_url', 'github_url',
  'city', 'country',
  'school', 'degree', 'graduation_year',
  'work_authorization', 'requires_sponsorship',
  'availability_start', 'internship_duration_months',
  'cv_fr_path', 'cv_en_path',
  'auto_apply_min_score',
];

const OPTIONAL_FIELDS = [
  'date_of_birth', 'nationality', 'website_url', 'postal_code',
  'current_year', 'languages',
  'education', 'experiences',
  'gender', 'ethnicity', 'veteran_status', 'disability_status',
];

function validateEducationEntry(e, i) {
  const errs = [];
  if (!e || typeof e !== 'object') return [`education[${i}] must be an object`];
  for (const k of ['school', 'degree', 'start']) {
    if (!e[k]) errs.push(`education[${i}].${k} is required`);
  }
  return errs;
}

function validateExperienceEntry(e, i) {
  const errs = [];
  if (!e || typeof e !== 'object') return [`experiences[${i}] must be an object`];
  for (const k of ['company', 'title', 'start']) {
    if (!e[k]) errs.push(`experiences[${i}].${k} is required`);
  }
  return errs;
}

export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile must be an object'] };
  }
  for (const f of REQUIRED_FIELDS) {
    if (profile[f] === undefined || profile[f] === null || profile[f] === '') {
      errors.push(`missing required field: ${f}`);
    }
  }
  if (profile.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email)) {
    errors.push('email format invalid');
  }
  if (profile.auto_apply_min_score !== undefined &&
      (typeof profile.auto_apply_min_score !== 'number' ||
       profile.auto_apply_min_score < 0 || profile.auto_apply_min_score > 10)) {
    errors.push('auto_apply_min_score must be a number between 0 and 10');
  }
  if (profile.education !== undefined) {
    if (!Array.isArray(profile.education)) {
      errors.push('education must be an array');
    } else {
      profile.education.forEach((e, i) => errors.push(...validateEducationEntry(e, i)));
    }
  }
  if (profile.experiences !== undefined) {
    if (!Array.isArray(profile.experiences)) {
      errors.push('experiences must be an array');
    } else {
      profile.experiences.forEach((e, i) => errors.push(...validateExperienceEntry(e, i)));
    }
  }
  const known = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  for (const k of Object.keys(profile)) {
    if (!known.has(k)) errors.push(`unknown field: ${k}`);
  }
  return { ok: errors.length === 0, errors };
}
