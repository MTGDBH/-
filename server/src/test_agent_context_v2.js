import assert from 'node:assert/strict';
import db from './db.js';
import {
  buildContextPlan,
  classifyAgentIntent,
  createMemoryCandidate,
  resolveAgentSubject,
} from './ai/orchestratorV2.js';

function removeTestUser(id) {
  db.prepare('DELETE FROM agent_memories WHERE subject_user_id=? OR actor_user_id=?').run(id, id);
  db.prepare('DELETE FROM chat_messages WHERE user_id=?').run(id);
  db.prepare('DELETE FROM agent_conversations WHERE actor_user_id=? OR subject_user_id=?').run(id, id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}

for (const old of db.prepare("SELECT id FROM users WHERE name LIKE 'v2-caregiver-%' OR name LIKE 'v2-senior-%'").all()) removeTestUser(old.id);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let caregiverId;
let seniorId;
try {
  caregiverId = Number(db.prepare(`INSERT INTO users (name,password,role,age,gender) VALUES (?,?,'caregiver',45,'female')`).run(`v2-caregiver-${suffix}`, '123456').lastInsertRowid);
  seniorId = Number(db.prepare(`INSERT INTO users (name,password,role,age,gender) VALUES (?,?,'senior',76,'male')`).run(`v2-senior-${suffix}`, '123456').lastInsertRowid);
  const caregiver = db.prepare('SELECT * FROM users WHERE id=?').get(caregiverId);

  assert.equal(resolveAgentSubject(caregiver, seniorId).error, 403, '未授权家属必须拒绝');
  db.prepare(`INSERT INTO care_relationships (senior_id,member_id,status) VALUES (?,?,'active')`).run(seniorId, caregiverId);
  assert.equal(resolveAgentSubject(caregiver, seniorId).subject.id, seniorId, '有效家属授权应允许读取');
  db.prepare(`UPDATE care_relationships SET status='revoked' WHERE senior_id=? AND member_id=?`).run(seniorId, caregiverId);
  assert.equal(resolveAgentSubject(caregiver, seniorId).error, 403, '撤销授权后必须立即拒绝');

  const conversationId = Number(db.prepare('INSERT INTO agent_conversations (actor_user_id,subject_user_id,title) VALUES (?,?,?)').run(seniorId, seniorId, '上下文预算测试').lastInsertRowid);
  for (let i = 0; i < 20; i++) db.prepare(`INSERT INTO chat_messages (user_id,role,content,conversation_id,actor_user_id,subject_user_id) VALUES (?,'user',?,?,?,?)`).run(seniorId, `${i}-${'偏好讨论'.repeat(700)}`, conversationId, seniorId, seniorId);
  const conversation = db.prepare('SELECT * FROM agent_conversations WHERE id=?').get(conversationId);
  const subject = db.prepare('SELECT * FROM users WHERE id=?').get(seniorId);
  const context = buildContextPlan(conversation, subject, '继续刚才的话题', classifyAgentIntent('继续刚才的话题'), null);
  assert.ok(context.manifest.estimated_tokens <= 12000, '可裁剪上下文应控制在12K token预算内');
  assert.ok(context.manifest.pruned.includes('oldest_turn'));

  const sourceMessage = db.prepare('SELECT id FROM chat_messages WHERE conversation_id=? LIMIT 1').get(conversationId);
  assert.ok(createMemoryCandidate(seniorId, seniorId, sourceMessage.id, '请记住我习惯早上散步'));
  assert.equal(createMemoryCandidate(seniorId, seniorId, sourceMessage.id, '请记住我的血压是160/100'), null, '健康数值不得进入长期记忆');
} finally {
  if (seniorId) {
    removeTestUser(seniorId);
    seniorId = null;
  }
  if (caregiverId) removeTestUser(caregiverId);
}

console.log('agent v2 context, memory and caregiver isolation: PASS');
