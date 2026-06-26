export type PlanLike = {
  plan?: string | null;
  plan_expires?: string | Date | null;
};

export function isActivePro(user: PlanLike): boolean {
  if (user.plan !== 'pro') return false;
  if (!user.plan_expires) return true;
  return new Date(user.plan_expires) > new Date();
}

export const PRO_REQUIRED_ERROR = 'Эта функция доступна на PRO';
