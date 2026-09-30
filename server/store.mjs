import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
export class Store{
 constructor(dir){mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(join(dir,'pinwell.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, project_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, calls INTEGER NOT NULL);`)}
 get(id){const row=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id);return row?JSON.parse(row.body):null}
 put(p){p.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p));return p}
 list(){return this.db.prepare('SELECT body FROM projects ORDER BY rowid DESC').all().map(x=>JSON.parse(x.body))}
 findRequest(key){return this.db.prepare('SELECT project_id FROM requests WHERE key=?').get(key)?.project_id}
 setRequest(key,id){this.db.prepare('INSERT INTO requests VALUES(?,?)').run(key,id)}
 reserve(limit){const day=new Date().toISOString().slice(0,10);this.db.exec('BEGIN IMMEDIATE');try{const used=this.db.prepare('SELECT calls FROM usage WHERE day=?').get(day)?.calls||0;if(used>=limit)throw Error('Daily provider-call limit reached. Try tomorrow or adjust the server limit.');this.db.prepare('INSERT INTO usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 close(){this.db.close()}
}
