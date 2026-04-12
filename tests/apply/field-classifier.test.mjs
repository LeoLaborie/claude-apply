import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyField,
  classifyAddButton,
  mapProfileValue,
  countEntriesForSection,
} from '../../src/apply/field-classifier.mjs';

const cases = [
  [{ name: 'email', type: 'email', label: 'Email Address' }, 'email'],
  [{ name: 'firstName', type: 'text', label: 'First Name' }, 'first_name'],
  [{ name: 'prenom', type: 'text', label: 'Prénom' }, 'first_name'],
  [{ name: 'lastName', type: 'text', label: 'Last Name' }, 'last_name'],
  [{ name: 'nom', type: 'text', label: 'Nom' }, 'last_name'],
  [{ name: 'fullName', type: 'text', label: 'Full Name' }, 'full_name'],
  [{ name: 'phone', type: 'tel', label: 'Phone' }, 'phone'],
  [{ name: 'telephone', type: 'text', label: 'Téléphone' }, 'phone'],
  [{ name: 'linkedin', type: 'url', label: 'LinkedIn URL' }, 'linkedin'],
  [{ name: 'github', type: 'url', label: 'GitHub' }, 'github'],
  [{ name: 'resume', type: 'file', label: 'Resume / CV' }, 'cv_upload'],
  [{ name: 'cv', type: 'file', label: 'Curriculum Vitae' }, 'cv_upload'],
  [{ name: 'coverLetter', type: 'file', label: 'Cover Letter' }, 'cover_letter_upload'],
  [
    { name: 'lettreMotivation', type: 'textarea', label: 'Lettre de motivation' },
    'cover_letter_text',
  ],
  [{ name: 'transcript', type: 'file', label: 'Transcripts' }, 'transcript_upload'],
  [{ name: 'releve', type: 'file', label: 'Relevé de notes' }, 'transcript_upload'],
  [{ name: 'portfolio', type: 'file', label: 'Portfolio' }, 'portfolio_upload'],
  [{ name: 'samples', type: 'file', label: 'Writing Sample' }, 'portfolio_upload'],
  [{ name: 'additional', type: 'file', label: 'Additional Documents' }, 'other_upload'],
  [{ name: 'other', type: 'file', label: 'Other Document' }, 'other_upload'],
  [{ name: 'gender', type: 'select', label: 'Gender Identity' }, 'eeo_gender'],
  [{ name: 'veteran', type: 'select', label: 'Veteran Status' }, 'eeo_veteran'],
  [{ name: 'disability', type: 'select', label: 'Disability Status' }, 'eeo_disability'],
  [{ name: 'school', type: 'text', label: 'University' }, 'education_school'],
  [{ name: 'etablissement', type: 'text', label: 'École' }, 'education_school'],
  [{ name: 'degree', type: 'text', label: 'Degree' }, 'education_degree'],
  [{ name: 'diplome', type: 'text', label: 'Diplôme' }, 'education_degree'],
  [{ name: 'field', type: 'text', label: 'Field of Study' }, 'education_field'],
  [{ name: 'major', type: 'text', label: 'Major' }, 'education_field'],
  [{ name: 'company', type: 'text', label: 'Company' }, 'experience_company'],
  [{ name: 'employer', type: 'text', label: 'Employer' }, 'experience_company'],
  [{ name: 'entreprise', type: 'text', label: 'Entreprise' }, 'experience_company'],
  [{ name: 'title', type: 'text', label: 'Job Title' }, 'experience_title'],
  [{ name: 'poste', type: 'text', label: 'Poste' }, 'experience_title'],
  [{ name: 'start', type: 'date', label: 'Start Date' }, 'experience_start'],
  [{ name: 'end', type: 'date', label: 'End Date' }, 'experience_end'],
  [{ name: 'graduation_year', type: 'number', label: 'Graduation Year' }, 'graduation_year'],
  [
    { name: 'workAuth', type: 'select', label: 'Are you authorized to work in the EU?' },
    'work_auth',
  ],
  [
    { name: 'sponsorship', type: 'select', label: 'Will you require visa sponsorship?' },
    'sponsorship',
  ],
  [{ name: 'availability', type: 'date', label: 'Availability Date' }, 'availability'],
  [{ name: 'whyUs', type: 'textarea', label: 'Why do you want to work with us?' }, 'free_text'],
  [{ name: 'custom_xyz', type: 'text', label: 'Something unknown' }, 'unknown'],
];

for (const [field, expected] of cases) {
  test(`classifyField: ${field.label} → ${expected}`, () => {
    assert.equal(classifyField(field), expected);
  });
}

const addButtonCases = [
  ['+ Add education', 'education'],
  ['Add another school', 'education'],
  ['Ajouter une formation', 'education'],
  ['+ Add experience', 'experience'],
  ['Add employment', 'experience'],
  ['Ajouter un emploi', 'experience'],
  ['+ Add language', 'language'],
  ['Ajouter une langue', 'language'],
  ['+ Add link', 'link'],
  ['Add website', 'link'],
  ['+ Add skill', 'skill'],
  ['Ajouter une compétence', 'skill'],
  ['Submit application', null],
  ['Cancel', null],
];

for (const [label, expected] of addButtonCases) {
  test(`classifyAddButton: "${label}" → ${expected}`, () => {
    assert.equal(classifyAddButton(label), expected);
  });
}

test('mapProfileValue: indexed education entries', () => {
  const profile = {
    first_name: 'Alice',
    last_name: 'Martin',
    education: [
      {
        school: 'State University',
        degree: 'Engineer',
        field: 'Computer Science',
        start: '2023-09',
        end: '2028-06',
      },
      {
        school: 'Central High School',
        degree: 'Baccalaureate',
        field: 'Maths-CS',
        start: '2020-09',
        end: '2023-06',
      },
    ],
  };
  assert.equal(
    mapProfileValue('education_school', profile, { educationIndex: 0 }),
    'State University'
  );
  assert.equal(
    mapProfileValue('education_school', profile, { educationIndex: 1 }),
    'Central High School'
  );
  assert.equal(mapProfileValue('education_field', profile, { educationIndex: 1 }), 'Maths-CS');
});

test('mapProfileValue: indexed experience entries', () => {
  const profile = {
    experiences: [
      {
        company: 'Acme Corp',
        title: 'CTO',
        start: '2025-01',
        end: 'present',
        description: 'B2C platform',
      },
      { company: 'WidgetsCo', title: 'Mobile Dev', start: '2025-11', end: '2025-11' },
    ],
  };
  assert.equal(mapProfileValue('experience_company', profile, { experienceIndex: 0 }), 'Acme Corp');
  assert.equal(mapProfileValue('experience_title', profile, { experienceIndex: 1 }), 'Mobile Dev');
  assert.equal(
    mapProfileValue('experience_summary', profile, { experienceIndex: 0 }),
    'B2C platform'
  );
});

test('countEntriesForSection', () => {
  const profile = {
    education: [{}, {}],
    experiences: [{}, {}, {}, {}],
    languages: [{}, {}, {}],
  };
  assert.equal(countEntriesForSection('education', profile), 2);
  assert.equal(countEntriesForSection('experience', profile), 4);
  assert.equal(countEntriesForSection('language', profile), 3);
  assert.equal(countEntriesForSection('skill', profile), 0);
});
