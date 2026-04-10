import { truncateJd } from './jd-truncate.mjs';

const SYSTEM = `Tu notes des offres de stage pour un candidat étudiant ingénieur Génie Informatique.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte hors JSON: {"score": X.X, "verdict": "apply"|"skip", "reason": "<20 mots max>"}.
Échelle: 5.0=parfait, 4.0=très bon, 3.5=bon (seuil candidature), 3.0=moyen, <3.0=skip.`;

const CRITERIA = `# Critères de scoring
- Match technique (40%): langages/frameworks/domaine vs CV
- Archétype (30%): Data/ML/AI/RL primary, Software secondary, reste tertiary
- Prestige/apprentissage (20%): taille entreprise, notoriété tech, mentorship
- Red flags (10%): durée hors 6 mois, formation requise absente, stack exclue`;

export function buildPrompt({ profileCondensed, offer, jdMaxTokens = 1500 }) {
  const jd = truncateJd(offer.body || '', jdMaxTokens);
  const user = `# Profil condensé
${profileCondensed}

${CRITERIA}

# Offre
Company: ${offer.company || 'unknown'}
Title: ${offer.title || 'unknown'}
Location: ${offer.location || 'unknown'}
JD:
${jd}`;
  return { system: SYSTEM, user };
}
