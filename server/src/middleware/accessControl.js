import { hasPermission } from '../contracts/accessControl.js';

export function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '登录状态已失效，请重新登录' });
    if (!hasPermission(req.user.role, capability)) return res.status(403).json({ error: '当前账号没有执行此操作的权限' });
    next();
  };
}

