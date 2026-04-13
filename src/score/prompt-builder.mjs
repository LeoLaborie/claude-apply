import { truncateJd } from './jd-truncate.mjs';

const SYSTEM = `Tu notes des offres de stage pour un candidat étudiant ingénieur Génie Informatique.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte hors JSON: {"score": X.X, "reason": "<20 mots max>"}.
Échelle 0-10: 10=parfait, 8=très bon, 7=bon, 5=moyen, <5=faible. Ne retourne PAS de verdict — il est calculé en aval à partir du seuil utilisateur.`;

const CRITERIA = `# Critères de scoring
- Match technique (40%): langages/frameworks/domaine vs CV
- Archétype (30%): Data/ML/AI/RL primary, Software secondary, reste tertiary
- Prestige/apprentissage (20%): taille entreprise, notoriété tech, mentorship
- Red flags (10%): durée hors 6 mois, formation requise absente, stack exclue`;

export function buildPrompt({ cvMarkdown, offer, jdMaxTokens = 1500 }) {
  const jd = truncateJd(offer.body || '', jdMaxTokens);
  const user = `# Profil candidat
${cvMarkdown}

${CRITERIA}

# Offre
Company: ${offer.company || 'unknown'}
Title: ${offer.title || 'unknown'}
Location: ${offer.location || 'unknown'}
JD:
${jd}`;
  return { system: SYSTEM, user };
}
