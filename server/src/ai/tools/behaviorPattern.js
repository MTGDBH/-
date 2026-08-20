import { buildHealthContext } from '../contextBuilder.js';

export function analyzeBehavior(userId, user) {
  const ctx = buildHealthContext({ ...user, id: userId }, 30);
  return { success: true, behavior: ctx.behavior, disclaimer: '步数和睡眠受日常活动影响，结果用于行为管理，不是医学未来预测。' };
}
