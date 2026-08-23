import assert from 'node:assert/strict';
import db from './db.js';
import { dailyTipForSubject } from './routes/api.js';

const subject = db.prepare("SELECT id,name FROM users WHERE role='senior' ORDER BY id LIMIT 1").get();
assert.ok(subject, '测试需要老人账号');

const rollback = Symbol('rollback');
try {
  db.transaction(() => {
    db.prepare("DELETE FROM knowledge_articles WHERE category='tip'").run();
    db.prepare(`INSERT INTO knowledge_articles (category,title,summary,body,tags,audience,review_status)
      VALUES ('tip','每日伸展','每天量力做舒缓活动。','每天量力做舒缓活动。','["运动"]','senior','pending')`).run();
    const first = dailyTipForSubject(subject);
    const second = dailyTipForSubject(subject);
    assert.deepEqual(first, second, '同一老人同一天的贴士必须稳定');
    assert.equal(first.tip.display_status, 'research_preview');
    assert.equal(first.tip.personalized, false, '未审核贴士禁止个性化');
    assert.match(first.tip.safety_text, /尚未完成医学审核/);
    db.prepare("UPDATE knowledge_articles SET review_status='approved',review_version='test-v1',reviewed_at=? WHERE category='tip'").run(new Date().toISOString());
    const approved = dailyTipForSubject(subject);
    assert.equal(approved.tip.display_status, 'approved');
    assert.equal(approved.tip.review_version, 'test-v1');
    throw rollback;
  })();
} catch (error) {
  if (error !== rollback) throw error;
}

console.log('agent single-entry daily tip: PASS');
