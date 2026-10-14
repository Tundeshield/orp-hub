export const ROLES = {
  admin: 'Administrator',
  pastor: 'Resident Pastor',
  assistant: 'Pastor\'s Assistant',
  finance: 'Finance Officer',
  leader: 'Ministry Leader',
  member: 'Staff / Member',
};

export function can(profile, ...roles) {
  return !!profile?.active && (profile.roles || []).some((r) => roles.includes(r));
}

export const isPastor = (p) => can(p, 'pastor');
export const isFinance = (p) => can(p, 'finance');
export const isFinanceViewer = (p) => can(p, 'pastor', 'finance', 'admin');
export const isDiaryManager = (p) => can(p, 'pastor', 'assistant', 'admin');
export const isReviewer = (p) => can(p, 'pastor', 'assistant', 'admin');
export const isAdmin = (p) => can(p, 'admin');
