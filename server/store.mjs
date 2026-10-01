import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {techniqueSeed,resourceSeed} from './techniques.mjs';
export class Store{
 constructor(dir){mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(join(dir,'pinwell.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');this.migrate();this.seedTechniques()}
 migrate(){
  this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations=[
   ['001-core',()=>this.db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, project_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, calls INTEGER NOT NULL);')],
   ['002-dibby',()=>this.db.exec(`
    CREATE TABLE IF NOT EXISTS techniques(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      medium TEXT NOT NULL CHECK(medium IN ('acrylic','watercolor','graphite','charcoal','colored pencil','ink','oil','universal')),
      skill_level TEXT NOT NULL CHECK(skill_level IN ('beginner','intermediate','advanced')),
      problem_categories TEXT NOT NULL,
      symptom_phrases TEXT NOT NULL,
      surfaces TEXT NOT NULL,
      tools TEXT NOT NULL,
      material_conditions TEXT NOT NULL,
      explanation TEXT NOT NULL,
      next_action TEXT NOT NULL,
      practice_exercise TEXT NOT NULL,
      clarifying_questions TEXT NOT NULL,
      caution_notes TEXT NOT NULL,
      provenance TEXT NOT NULL,
      review_status TEXT NOT NULL CHECK(review_status IN ('editorial_draft','verified','rejected')),
      created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS technique_resources(
      id TEXT PRIMARY KEY,
      technique_id TEXT NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('article','video','book','manufacturer')),
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      source_url TEXT NOT NULL,
      youtube_id TEXT,
      start_seconds INTEGER,
      end_seconds INTEGER,
      review_status TEXT NOT NULL CHECK(review_status IN ('candidate','verified','rejected')),
      last_verified TEXT,
      availability TEXT NOT NULL CHECK(availability IN ('available','unavailable','unknown')),
      embedding_status TEXT NOT NULL DEFAULT 'unknown' CHECK(embedding_status IN ('embeddable','not_embeddable','not_applicable','unknown')),
      CHECK((youtube_id IS NULL) OR (length(youtube_id)=11)),
      CHECK(start_seconds IS NULL OR start_seconds >= 0),
      CHECK(end_seconds IS NULL OR end_seconds >= 0),
      CHECK(start_seconds IS NULL OR end_seconds IS NULL OR end_seconds > start_seconds)
    );
    CREATE TABLE IF NOT EXISTS technique_feedback(
      id TEXT PRIMARY KEY,
      technique_id TEXT REFERENCES techniques(id) ON DELETE SET NULL,
      helped INTEGER NOT NULL CHECK(helped IN (0,1)),
      comment TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dibby_requests(
      key TEXT PRIMARY KEY,
      status INTEGER NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_techniques_medium_review ON techniques(medium,review_status);
    CREATE INDEX IF NOT EXISTS idx_technique_resources_technique ON technique_resources(technique_id,review_status);
    CREATE INDEX IF NOT EXISTS idx_feedback_technique ON technique_feedback(technique_id,created_at);
   `)],
   ['003-resource-embedding-status',()=>{const columns=this.db.prepare('PRAGMA table_info(technique_resources)').all().map(x=>x.name);if(!columns.includes('embedding_status'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'unknown' CHECK(embedding_status IN ('embeddable','not_embeddable','not_applicable','unknown'))") }]
   ,['004-resource-provenance-links',()=>{
     const columns=this.db.prepare('PRAGMA table_info(technique_resources)').all().map(x=>x.name);
     if(!columns.includes('focus'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN focus TEXT NOT NULL DEFAULT 'general'");
     if(!columns.includes('teaches'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN teaches TEXT NOT NULL DEFAULT ''");
     if(!columns.includes('review_evidence'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN review_evidence TEXT NOT NULL DEFAULT ''");
     if(!columns.includes('review_method'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN review_method TEXT NOT NULL DEFAULT 'metadata'");
     if(!columns.includes('duration_seconds'))this.db.exec("ALTER TABLE technique_resources ADD COLUMN duration_seconds INTEGER");
     this.db.exec(`CREATE TABLE IF NOT EXISTS technique_resource_links(
       resource_id TEXT NOT NULL REFERENCES technique_resources(id) ON DELETE CASCADE,
       technique_id TEXT NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
       PRIMARY KEY(resource_id,technique_id)
      );
      `);
     this.db.exec('INSERT OR IGNORE INTO technique_resource_links(resource_id,technique_id) SELECT id,technique_id FROM technique_resources');
     this.db.exec('CREATE INDEX IF NOT EXISTS idx_resource_links_technique ON technique_resource_links(technique_id)');
   }]
  ];
  const applied=new Set(this.db.prepare('SELECT version FROM schema_migrations').all().map(x=>x.version));
  for(const [version,apply] of migrations){if(applied.has(version))continue;this.db.exec('BEGIN');try{apply();this.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 }
 seedTechniques(){
  const now=new Date().toISOString();
  this.db.exec('BEGIN');
  try{
   const insert=this.db.prepare(`INSERT OR IGNORE INTO techniques(id,title,medium,skill_level,problem_categories,symptom_phrases,surfaces,tools,material_conditions,explanation,next_action,practice_exercise,clarifying_questions,caution_notes,provenance,review_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
   for(const t of techniqueSeed)insert.run(t.id,t.title,t.medium,t.skill,t.categories.join('|'),t.symptoms.join('|'),t.surfaces.join('|'),t.tools.join('|'),t.conditions.join('|'),t.explanation,t.nextAction,t.practice, t.questions.join('|'),t.caution,t.provenance,t.review,now,now);
   const resource=this.db.prepare(`INSERT OR IGNORE INTO technique_resources(id,technique_id,resource_type,title,creator,source_url,youtube_id,start_seconds,end_seconds,review_status,last_verified,availability,embedding_status,focus,teaches,review_evidence,review_method,duration_seconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
   const link=this.db.prepare('INSERT OR IGNORE INTO technique_resource_links(resource_id,technique_id) VALUES(?,?)');
   for(const r of resourceSeed){resource.run(r.id,r.techniqueId,r.type,r.title,r.creator,r.sourceUrl,r.youtubeId||null,r.startSeconds??null,r.endSeconds??null,r.review,r.lastVerified||null,r.availability,r.embedding||'unknown',r.focus||'general',r.teaches||'',r.reviewEvidence||'',r.reviewMethod||'metadata',r.durationSeconds??null);link.run(r.id,r.techniqueId)}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 get(id){const row=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id);return row?JSON.parse(row.body):null}
 put(p){p.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p));return p}
 list(){return this.db.prepare('SELECT body FROM projects ORDER BY rowid DESC').all().map(x=>JSON.parse(x.body))}
 findRequest(key){return this.db.prepare('SELECT project_id FROM requests WHERE key=?').get(key)?.project_id}
 setRequest(key,id){this.db.prepare('INSERT INTO requests VALUES(?,?)').run(key,id)}
 listTechniques(){return this.db.prepare('SELECT * FROM techniques ORDER BY title').all().map(row=>this.technique(row))}
 getTechnique(id){const row=this.db.prepare('SELECT * FROM techniques WHERE id=?').get(id);return row?this.technique(row):null}
 technique(row){const split=v=>String(v||'').split('|').filter(Boolean);return {id:row.id,title:row.title,medium:row.medium,skillLevel:row.skill_level,problemCategories:split(row.problem_categories),symptomPhrases:split(row.symptom_phrases),surfaces:split(row.surfaces),tools:split(row.tools),materialConditions:split(row.material_conditions),explanation:row.explanation,nextAction:row.next_action,practiceExercise:row.practice_exercise,clarifyingQuestions:split(row.clarifying_questions),cautionNotes:row.caution_notes,provenance:row.provenance,reviewStatus:row.review_status,resources:this.db.prepare(`SELECT r.id,r.resource_type resourceType,r.title,r.creator,r.source_url sourceUrl,r.youtube_id youtubeId,r.start_seconds startSeconds,r.end_seconds endSeconds,r.review_status reviewStatus,r.last_verified lastVerified,r.availability,r.embedding_status embeddingStatus,r.focus,r.teaches,r.review_evidence reviewEvidence,r.review_method reviewMethod,r.duration_seconds durationSeconds FROM technique_resources r JOIN technique_resource_links l ON l.resource_id=r.id WHERE l.technique_id=? AND r.review_status<>'rejected' AND r.availability='available' ORDER BY r.review_status DESC,r.title`).all(row.id)}}
 findDibbyRequest(key){const row=this.db.prepare('SELECT status,response FROM dibby_requests WHERE key=?').get(key);return row?{status:row.status,response:JSON.parse(row.response)}:null}
 setDibbyRequest(key,status,response){this.db.prepare('INSERT INTO dibby_requests(key,status,response,created_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET status=excluded.status,response=excluded.response').run(key,status,JSON.stringify(response),new Date().toISOString())}
 addFeedback({id,techniqueId,helped,comment}){this.db.prepare('INSERT INTO technique_feedback(id,technique_id,helped,comment,created_at) VALUES(?,?,?,?,?)').run(id,techniqueId||null,helped?1:0,comment||null,new Date().toISOString())}
 importResources(records){this.db.exec('BEGIN');try{const query=this.db.prepare(`INSERT INTO technique_resources(id,technique_id,resource_type,title,creator,source_url,youtube_id,start_seconds,end_seconds,review_status,last_verified,availability,embedding_status,focus,teaches,review_evidence,review_method,duration_seconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET technique_id=excluded.technique_id,resource_type=excluded.resource_type,title=excluded.title,creator=excluded.creator,source_url=excluded.source_url,youtube_id=excluded.youtube_id,start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds,review_status=excluded.review_status,last_verified=excluded.last_verified,availability=excluded.availability,embedding_status=excluded.embedding_status,focus=excluded.focus,teaches=excluded.teaches,review_evidence=excluded.review_evidence,review_method=excluded.review_method,duration_seconds=excluded.duration_seconds`);const clear=this.db.prepare('DELETE FROM technique_resource_links WHERE resource_id=?'),link=this.db.prepare('INSERT INTO technique_resource_links(resource_id,technique_id) VALUES(?,?)');for(const r of records){query.run(r.id,r.techniqueId,r.resourceType,r.title,r.creator,r.sourceUrl,r.youtubeId||null,r.startSeconds??null,r.endSeconds??null,r.reviewStatus,r.lastVerified||null,r.availability,r.embeddingStatus||'unknown',r.focus||'general',r.teaches||'',r.reviewEvidence||'',r.reviewMethod||'metadata',r.durationSeconds??null);clear.run(r.id);for(const id of r.techniqueIds||[r.techniqueId])link.run(r.id,id)}this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 resourceCoverage(){return this.db.prepare(`SELECT t.id,t.title,t.review_status reviewStatus,COUNT(CASE WHEN r.review_status='verified' AND r.availability='available' THEN 1 END) reviewedResources,COUNT(CASE WHEN r.availability='available' THEN 1 END) availableResources FROM techniques t LEFT JOIN technique_resource_links l ON l.technique_id=t.id LEFT JOIN technique_resources r ON r.id=l.resource_id GROUP BY t.id ORDER BY t.title`).all()}
 reserve(limit){const day=new Date().toISOString().slice(0,10);this.db.exec('BEGIN IMMEDIATE');try{const used=this.db.prepare('SELECT calls FROM usage WHERE day=?').get(day)?.calls||0;if(used>=limit)throw Error('Daily provider-call limit reached. Try tomorrow or adjust the server limit.');this.db.prepare('INSERT INTO usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 close(){this.db.close()}
}
