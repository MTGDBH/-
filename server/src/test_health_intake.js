import assert from 'node:assert/strict';
import { scoreIntake, intakeSchema } from './lib/intake.js';
import { diseaseModelGate } from './lib/diseaseModelGate.js';
const schema = intakeSchema();
assert.equal(schema.schema_version, 'elderly-intake.v1');
assert.ok(schema.questions.length >= 30);
assert.ok(schema.questions.every(question => !/cesd10|adlab_c|iadl/.test(question.prompt)));
const scored = scoreIntake({self_rated_health:5,adl_dressing:1,adl_bathing:0,adl_eating:1,adl_bed:0,adl_toilet:0,adl_continence:0,iadl_shopping:1,iadl_cooking:0,iadl_medication:0,iadl_money:1,iadl_housework:0,cesd_bothered:3,cesd_concentrate:2,cesd_depressed:1,cesd_effort:0,cesd_hopeful:3,cesd_fearful:0,cesd_sleep:1,cesd_happy:3,cesd_lonely:0,cesd_cannot_go:0});
assert.equal(scored.scores.adlab_c,2);assert.equal(scored.scores.iadl,2);assert.equal(scored.scores.srh_charls,1);assert.equal(scored.scores.cesd10,7);
const partial=scoreIntake({adl_dressing:1,iadl_shopping:1,cesd_bothered:2});assert.equal(partial.scores.adlab_c,null);assert.equal(partial.scores.iadl,null);assert.equal(partial.scores.cesd10,null);
for(const disease of ['hypertension','diabetes','heart_disease','stroke']){const gate=diseaseModelGate(disease);assert.equal(gate.passed,false);assert.equal(gate.checks.subgroup_fairness,false);assert.equal(gate.checks.artifact_binding,false)}
console.log('health intake scoring and disease publication gate: PASS');
