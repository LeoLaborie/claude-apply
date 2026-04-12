const norm = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const test_norm = (pattern, label, name) => {
  const combined = norm(label) + ' ' + norm(name);
  return pattern.test(combined);
};

const RULES = [
  {
    key: 'cover_letter_upload',
    when: (f) => f.type === 'file' && test_norm(/(cover|motivation|lettre)/, f.label, f.name),
  },
  {
    key: 'transcript_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/transcript|releve de notes|academic record|grade report|bulletin/, f.label, f.name),
  },
  {
    key: 'portfolio_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/portfolio|work sample|travaux|book|writing sample|echantillon/, f.label, f.name),
  },
  {
    key: 'other_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/additional.*doc|other.*doc|autre.*doc|supplement|piece jointe/, f.label, f.name),
  },
  {
    key: 'cv_upload',
    when: (f) => f.type === 'file' && test_norm(/(resume|curriculum|cv|cv.file)/, f.label, f.name),
  },
  { key: 'cv_upload', when: (f) => f.type === 'file' },
  {
    key: 'cover_letter_text',
    when: (f) =>
      f.type === 'textarea' && test_norm(/(cover letter|motivation|lettre)/, f.label, f.name),
  },
  {
    key: 'email',
    when: (f) => f.type === 'email' || test_norm(/email|courriel|e-mail/, f.label, f.name),
  },
  {
    key: 'phone',
    when: (f) => f.type === 'tel' || test_norm(/phone|telephone|mobile|portable/, f.label, f.name),
  },
  { key: 'linkedin', when: (f) => test_norm(/linkedin/, f.label, f.name) },
  { key: 'github', when: (f) => test_norm(/github|git-hub/, f.label, f.name) },
  {
    key: 'website',
    when: (f) => test_norm(/website|portfolio|personal site|site perso/, f.label, f.name),
  },
  { key: 'full_name', when: (f) => test_norm(/full name|nom complet|your name/, f.label, f.name) },
  {
    key: 'full_name',
    when: (f) =>
      test_norm(/\bname\b/, f.label, f.name) &&
      f.label &&
      f.label.toLowerCase().match(/^name$|^full name$|^nom$/),
  },
  {
    key: 'first_name',
    when: (f) => test_norm(/first name|given name|prenom|firstname/, f.label, f.name),
  },
  {
    key: 'last_name',
    when: (f) => test_norm(/last name|family name|surname|nom|lastname/, f.label, f.name),
  },
  {
    key: 'education_school',
    when: (f) =>
      test_norm(/school|university|universite|ecole|college|etablissement/, f.label, f.name),
  },
  {
    key: 'education_degree',
    when: (f) => test_norm(/degree|diplome|diploma|qualification/, f.label, f.name),
  },
  {
    key: 'education_field',
    when: (f) =>
      test_norm(/field of study|major|discipline|specialisation|domaine/, f.label, f.name),
  },
  {
    key: 'education_start',
    when: (f) =>
      test_norm(/start.*(education|school|studies|etudes)|debut.*etudes/, f.label, f.name),
  },
  {
    key: 'education_end',
    when: (f) =>
      test_norm(
        /end.*(education|school|studies|etudes)|fin.*etudes|graduation date/,
        f.label,
        f.name
      ),
  },
  {
    key: 'graduation_year',
    when: (f) =>
      test_norm(/graduation year|promo|year of graduation|annee diplome/, f.label, f.name),
  },
  {
    key: 'experience_company',
    when: (f) =>
      test_norm(/company|employer|entreprise|organisation|organization/, f.label, f.name),
  },
  {
    key: 'experience_title',
    when: (f) => test_norm(/job title|position|poste|role|intitule/, f.label, f.name),
  },
  {
    key: 'experience_start',
    when: (f) => test_norm(/start date|date de debut|start.*(work|job)/, f.label, f.name),
  },
  {
    key: 'experience_end',
    when: (f) => test_norm(/end date|date de fin|end.*(work|job)/, f.label, f.name),
  },
  {
    key: 'experience_summary',
    when: (f) =>
      test_norm(/description|summary.*(role|job|experience)|taches|missions/, f.label, f.name),
  },
  {
    key: 'work_auth',
    when: (f) =>
      test_norm(
        /work auth|authorized to work|right to work|eligible.*work|autorisation.*travail/,
        f.label,
        f.name
      ),
  },
  { key: 'sponsorship', when: (f) => test_norm(/sponsor|visa/, f.label, f.name) },
  {
    key: 'availability',
    when: (f) => test_norm(/availability|start date|date de debut|disponibilite/, f.label, f.name),
  },
  { key: 'eeo_gender', when: (f) => test_norm(/gender/, f.label, f.name) },
  { key: 'eeo_ethnicity', when: (f) => test_norm(/ethnicity|race/, f.label, f.name) },
  { key: 'eeo_veteran', when: (f) => test_norm(/veteran/, f.label, f.name) },
  { key: 'eeo_disability', when: (f) => test_norm(/disability|handicap/, f.label, f.name) },
  { key: 'free_text', when: (f) => f.type === 'textarea' },
];

export function classifyField(field) {
  for (const rule of RULES) {
    if (rule.when(field)) return rule.key;
  }
  return 'unknown';
}

export function mapProfileValue(classKey, profile, opts = {}) {
  const eduIdx = opts.educationIndex ?? 0;
  const expIdx = opts.experienceIndex ?? 0;
  const edu = profile.education?.[eduIdx] || {};
  const exp = profile.experiences?.[expIdx] || {};
  const map = {
    email: profile.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    full_name: `${profile.first_name} ${profile.last_name}`,
    phone: profile.phone,
    linkedin: profile.linkedin_url,
    github: profile.github_url,
    website: profile.website_url,
    education_school: edu.school ?? profile.school,
    education_degree: edu.degree ?? profile.degree,
    education_field: edu.field,
    education_start: edu.start,
    education_end: edu.end,
    graduation_year: profile.graduation_year,
    experience_company: exp.company,
    experience_title: exp.title,
    experience_start: exp.start,
    experience_end: exp.end,
    experience_summary: exp.description,
    work_auth: profile.work_authorization,
    sponsorship: profile.requires_sponsorship ? 'Yes' : 'No',
    availability: profile.availability_start,
    eeo_gender: profile.gender ?? 'Prefer not to say',
    eeo_ethnicity: profile.ethnicity ?? 'Prefer not to say',
    eeo_veteran: profile.veteran_status ?? 'Prefer not to say',
    eeo_disability: profile.disability_status ?? 'Prefer not to say',
    transcript_upload: profile.transcript_path ?? profile.cv_en_path,
    portfolio_upload: profile.portfolio_path ?? profile.cv_en_path,
    other_upload: profile.other_document_path ?? profile.cv_en_path,
  };
  return map[classKey];
}

const SECTION_BUTTON_PATTERNS = [
  {
    section: 'education',
    pattern: /\+?\s*add.*(education|school|studies|formation)|ajouter.*(formation|etudes)/i,
  },
  {
    section: 'experience',
    pattern:
      /\+?\s*add.*(experience|employment|work|job|emploi|poste)|ajouter.*(experience|emploi)/i,
  },
  { section: 'language', pattern: /\+?\s*add.*(language|langue)|ajouter.*langue/i },
  { section: 'link', pattern: /\+?\s*add.*(link|url|website|social)|ajouter.*(lien|url)/i },
  { section: 'skill', pattern: /\+?\s*add.*(skill|competence)|ajouter.*competence/i },
];

export function classifyAddButton(label) {
  const s = norm(label || '').trim();
  for (const { section, pattern } of SECTION_BUTTON_PATTERNS) {
    if (pattern.test(s)) return section;
  }
  return null;
}

export function countEntriesForSection(section, profile) {
  if (section === 'education') return profile.education?.length ?? 0;
  if (section === 'experience') return profile.experiences?.length ?? 0;
  if (section === 'language') return profile.languages?.length ?? 0;
  return 0;
}
