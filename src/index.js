const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const colors = require('colors');
const axios = require ('axios');

const API_URL = 'https://api.parsers.dev/api/v1';

const DB_SUPPORTED = ['postgresql'];

const callApi = async (apikey, db, data) => {
  let response = null;
  try{
    response = await axios({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apikey,
      },
      data,
      url: `${API_URL}/compile/${db}/`,
    });
  }catch(error){
    console.error('parsers.dev API error:'.red.bold);
    
    if(error.response){
      console.error(JSON.stringify(error.response.data, null, 2).red.bold);
    }else{
      console.error(error.message.red.bold)
    }
    process.exit(1)
  }

  return response;
}

// SO ;)
const spawnChild = async (command, argvArr, stdin) => {
  const child = spawn(command, argvArr);

  if(stdin != null){
    child.stdin.write(stdin);
    child.stdin.end();
  }

  let data = '';
  for await (const chunk of child.stdout) {
    data += chunk;
  }
  let error = '';
  for await (const chunk of child.stderr) {
    error += chunk;
  }
  const exitCode = await new Promise( (resolve, reject) => {
    child.on('close', resolve);
  });

  if(exitCode) {
    throw new Error(error);
  }
  return data;
}

const getRemoteHeadCommit = async (currentBranchName) => {
  const gitResult = await spawnChild('git', ['ls-remote', '--heads']);
  return gitResult
    .split('\n')
    .map(line => line.split('\t'))
    .map(hb => hb[1] === `refs/heads/${currentBranchName}` ? hb[0] : null)
    .filter(Boolean)
    [0]
  ;
}

// SO ;)
const readdirRecursive = (dirPath, arrayOfFiles) =>  {
  files = fsSync.readdirSync(dirPath)

  arrayOfFiles = arrayOfFiles || []

  files.forEach(function(file) {
    if (fsSync.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = readdirRecursive(dirPath + "/" + file, arrayOfFiles)
    } else {
      arrayOfFiles.push(path.join(dirPath, "/", file))
    }
  })

  return arrayOfFiles
}
;

const getChanges = async (localpath, isDirectory, remoteBranchHash) => {
  
  let remoteFilesHash = [];
  let remoteFilesHashFiltered = [];

  let localFiles = [];
  let localFilesHash = [];

  const deleted = [];

  // get remote branch files hash for DDL path
  try{
    remoteFilesHash = (await spawnChild('git', ['ls-tree', '-r', `${remoteBranchHash}:${isDirectory ? localpath : path.dirname(localpath)}`]))
      .split('\n')
      .slice(0, -1)
      .map(line => line.split('\t'))
      .map(hf => ({file: hf[1], hash: hf[0].split(' ')[2]}))
      .filter(hf => path.extname(hf.file).toLowerCase() === '.sql')
      .filter(hf => isDirectory || !isDirectory && path.join(path.dirname(localpath), hf.file) === path.join(localpath))
      .map(fh => ({file: fh.file, hash: fh.hash.trim()}))
    ;
  }catch(error){
    if(error.message.trim().slice(0,31) === 'fatal: Not a valid object name '){
      console.error(`The remote branch copy for path ${localpath} is not found in local storage. Maybe the remote branch is newer and not synced yet or files were renamed/moved locally.`.red.bold);  
    }else{
      console.error(error.message.red.bold, `for path ${localpath}`);
    }

    process.exit(1);
  }

  // local branch files hash
  try{
    // filter missed files
    const stats = (await Promise.allSettled(remoteFilesHash.map(fh => fs.stat(
      isDirectory 
        ? path.join(localpath, fh.file)
        : path.resolve(path.dirname(localpath), fh.file)
      ))))
      .map(r => r.status === 'fulfilled')
    ;

    // TODO: .reduce
    remoteFilesHashFiltered = remoteFilesHash.filter((fh, id) => {
      if(!stats[id]){
        console.log(`File '${path.join(path.dirname(localpath), fh.file)}' was deleted locally!`);
        deleted.push(fh);
      }
      return stats[id];
    });

    if(remoteFilesHashFiltered.length === 0){
      console.error('ALL locally files was deleted!'.red.bold);
      process.exit(1);
    }
  }catch(error){
    console.error(error.message);
    process.exit(1);
  }


  localFiles = isDirectory 
    ? readdirRecursive(localpath).map(f => path.relative(localpath, f))
    : [path.parse(localpath).base]
  ;

  localFilesHash = (await spawnChild('git', ['hash-object', '--stdin-path'],
    localFiles.map(f =>path.join(localpath, f)).join('\n')
  ))
    .split('\n')
    .map((h, id) => ({file: localFiles[id], hash: h}))
    .filter(fh => fh.hash !== '')
  ;

  if(localFilesHash.length === 0){
    throw new Error('Local branch files hash can\'t be collected');
  }
  
  const changedFiles = remoteFilesHashFiltered.filter((fh, id) => localFilesHash.find(lfh => lfh.hash === fh.hash &&  fh.file === lfh.file) == null);
  const newFiles = localFilesHash.filter(lfh => remoteFilesHashFiltered.find(fh => fh.file === lfh.file) == null);
  
  return {
    remote: remoteFilesHashFiltered,
    changed: changedFiles,
    new: newFiles, 
    deleted
  }
}

const buildFieldInfo = (field, original) => {
  const source = original != null ? `(${original.relation.schema != null && original.relation.schema != 'public' ? `${original.relation.schema}.`: ''}${original.relation.name}.${original.field})` : '';

  return `${field.kind} "${field.names.local || field.names.original}" ${(field.type.schema != null &&  field.type.schema === 'pg_catalog' ? '' : `${field.type.schema}.`)}${field.type.name.toUpperCase()} ${field.type.mods.length > 0 ? `(${field.type.mods.join(',')})` : ''}` +
  `${field.nullable === 'no' ? 'NOT NULL' : (field.nullable === 'yes' ? '' : '<unknown nullability>')}` +
  `  ${source}`;
}
  
const assertPairs = (dmlPairs, dmlFiles) => {
  let exitCode = 0;
  dmlPairs.forEach((item, id) => {
    console.log(`file '${dmlFiles[id].file.bold}':`);

    if(item.old.error == null){
      console.log(`  [pass] previous version parsed succeeded`.green);
    }else{
      console.log(`  [fail] previous version parsed with errors!`.red.bold);
    }
    if(item.new.error == null){
      console.log(`  [pass] new version parsed succeeded`.green);
    }else{
      console.log(`  [fail] new version parsed with errors!`.red.bold);
      exitCode = 1;
    }
    if(item.old.error == null && item.new.error == null){
      if(item.old.linesCount === item.new.linesCount){
        console.log(`  [pass] rows count class matched: `.green + `${item.old.linesCount}`.bold);
      }else{
        console.log(`  [fail] rows count class mismatch:`.red.bold +` ${item.old.linesCount}`.bold +` vs ` + `${item.new.linesCount}`.bold);
      }

      if(item.old.fields.length === item.new.fields.length){
        console.log(`  [pass] fields count matched`.green);
      }else{
        if(item.old.fields.length < item.new.fields.length){
          console.log(`  [warn] fields count increased from ${item.old.fields.length} to ${item.new.fields.length}`.yellow.bold);
        }else{
          console.log(`  [warn] fields count decreased from ${item.old.fields.length} to ${item.new.fields.length}`.yellow.bold);
        }
      }
      // 
      item.new.fields.forEach((newVersion, fid) => {
        const old = item.old.fields[fid];
        if(old == null){
          console.log(`    [warn] #${fid} ${(newVersion.names.local || newVersion.names.original)} - old version has no this field!`.yellow.bold);
        }else{
          let name = false;
          let typeName = false;
          let typeMods = false;
          let nullable = false;
          let kind = false;
          let source = false;
          
          if((old.names.local || old.names.original) ===  (newVersion.names.local || newVersion.names.original)){
            name = true;
          }
          if(old.type.schema === newVersion.type.schema && old.type.name === newVersion.type.name){
            typeName = true;
          }
          if(old.type.mods.length === newVersion.type.mods.length && old.type.mods.every((i, mid) => i === newVersion.type.mods[mid])){
            typeMods = true
          }
          if(old.nullable === newVersion.nullable){
            nullable = true
          }
      
          if(old.kind === newVersion.kind){
            kind = true
          }
      
          if(item.old.fieldsOriginal[fid] != null && item.new.fieldsOriginal[fid] != null
            && item.old.fieldsOriginal[fid].relation.schema === item.new.fieldsOriginal[fid].relation.schema 
            && item.old.fieldsOriginal[fid].relation.name === item.new.fieldsOriginal[fid].relation.name 
            && item.old.fieldsOriginal[fid].relation.field === item.new.fieldsOriginal[fid].relation.field 
            ||
            item.old.fieldsOriginal[fid] == null && item.new.fieldsOriginal[fid] == null
          ){
            source = true
          }
      
          if(name && typeName && typeMods && nullable && kind && source){
            console.log(`\tfield #${fid}: `.bold + `[pass] ${buildFieldInfo(newVersion, item.old.fieldsOriginal[fid])}`.green);
          }else{
            console.log(
              `\tfield #${fid}: [fail]\n\t\t${buildFieldInfo(newVersion, item.new.fieldsOriginal[fid])}`.red.bold +
              `\n\t\tvs\n` +
              `\t\t${buildFieldInfo(old, item.old.fieldsOriginal[fid])}`.red.bold
            );
          }
        }
      });
    }
  });
  return exitCode;
}

const check = async (params) => {
  console.info('\n== PARSERS.DEV type check is starting ==\n'.bold);

  let ddlPathIsDirectory = false;
  let dmlPathIsDirectory = false;

  if(!DB_SUPPORTED.includes(params.db)){
    console.error(`Supported DB: ${DB_SUPPORTED.join(', ')}`.red.bold);
    process.exit(1);
  }

  try{
    const statsDdl = await fs.stat(path.resolve(params.ddl));
    ddlPathIsDirectory = statsDdl.isDirectory();
  }catch(error){
    console.error(`DDL path ${params.ddl} not found locally`.red.bold); 
    process.exit(1);
  }

  try{
    const statsDml = await fs.stat(path.resolve(params.dml));
    dmlPathIsDirectory = statsDml.isDirectory();
  }catch(error){
    console.error(`DML path ${params.dml} not found locally`.red.bold); 
    process.exit(1);
  }

  let currentBranchName = null;
  let remoteBranchHash = null;
  let remoteBranchName = null;
  let exitCode = 0;
  
  // get current local branch
  try{
    currentBranchName = (await spawnChild('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    console.log(`Current branch is '${currentBranchName.bold}'`);
  }catch(error){
    console.error(error.message);
    process.exit(1);
  }

  // get remote branch HEAD commit hash
  try{
    console.log(`Getting remote branch '${currentBranchName.bold}' HEAD commit hash...`);
    remoteBranchName = currentBranchName;
    remoteBranchHash = await getRemoteHeadCommit(remoteBranchName);
    
    if(remoteBranchHash == null){
      console.log(`Remote branch '${remoteBranchName.bold}' not found, try to find parent branch...`.yellow.bold)
    // looking for parent remote branch
      const parentBranchName = (await spawnChild('sh', ['-c', 'git show-branch | sed "s/].*//" | grep "\*" | grep -v "$(git rev-parse --abbrev-ref HEAD)" | head -n1 | sed "s/^.*\\[//" ']) || '').trim();
      if(parentBranchName != null){
        console.log(`The parent branch is '${parentBranchName.bold}', getting remote branch HEAD commit hash...`);
        remoteBranchHash = await getRemoteHeadCommit(parentBranchName);
        remoteBranchName = parentBranchName;
        if(remoteBranchHash == null){
          throw new Error(`Remote branch '${parentBranchName}' not found`.red.bold);
        }
      }else{
        throw new Error(`Remote branch '${parentBranchName}' not found`.red.bold);
      }
    }
    console.log(`Remote branch '${remoteBranchName.bold}' hash is ${remoteBranchHash.bold}`)
  }catch(error){
    console.error(error.message);
    process.exit(1);
  }

  const ddlFiles = await getChanges(params.ddl, ddlPathIsDirectory, remoteBranchHash);
  const dmlFiles = await getChanges(params.dml, dmlPathIsDirectory, remoteBranchHash);

  if(ddlFiles.remote.length === 0){
    console.log('No DDL files was found'.yellow.bold);
    process.exit(0);
  }

  if(dmlFiles.changed.length === 0 && ddlFiles.changed.length === 0 && ddlFiles.new.length === 0){
    console.log('No need to refresh DML types'.yellow.bold);
    process.exit(0);
  }
  
  if(ddlFiles.deleted.length > 0 || ddlFiles.changed.length > 0 || ddlFiles.new.length > 0){
    const ddlsOld = (await Promise.allSettled(ddlFiles.remote.map(fh =>  spawnChild('git', ['cat-file', 'blob', fh.hash]))))
      .map(p => p.status === 'fulfilled' ? p.value.toString() : null);

    if(ddlsOld.includes(null)){
      console.error('Some local old DDL source files are unavalible'.red.bold);
      process.exit(1);
    }
    
    const dmlsOld = (await Promise.allSettled(dmlFiles.remote.map(fh => 
        spawnChild('git', ['cat-file', 'blob', fh.hash])
      )))
      .map(p => p.status === 'fulfilled' ? p.value.toString() : null);

    if(dmlsOld.includes(null)){
      console.error('Some local old DML source files are unavalible'.red.bold);
      process.exit(1);
    }

    const ddlsNew = (await Promise.allSettled(ddlFiles.remote.map(fh =>  fs.readFile(
      ddlPathIsDirectory 
        ? path.resolve(params.ddl, fh.file)
        : path.resolve(params.ddl)
      ))))
      .map(p => p.status === 'fulfilled' ? p.value.toString() : null);

    if(ddlsNew.includes(null)){
      console.error('Some local last DDL source files are unavalible'.yellow.bold);
      // process.exit(1);
    }
    
    const dmlsNew = (await Promise.allSettled(dmlFiles.remote.map(fh => fs.readFile(
        dmlPathIsDirectory 
          ? path.resolve(params.dml, fh.file)
          : path.resolve(params.dml),
      )
      )))
      .map(p => p.status === 'fulfilled' ? p.value.toString() : null);

    if(dmlsNew.includes(null)){
      console.error('Some local last  DML source files are unavalible'.yellow.bold);
      // process.exit(1);
    }

    const responseOldVersion = await callApi(params.apikey, params.db, { ddl: ddlsOld.join(';'), dmls:dmlsOld });
    const responseNewVersion = await callApi(params.apikey, params.db, { ddl: ddlsNew.join(';'), dmls:dmlsNew });

    const dmlPairs = responseOldVersion.data.data.compiled.dmls.map((o, id) => ({old: o[0], new: responseNewVersion.data.data.compiled.dmls[id][0] }));

    exitCode = assertPairs(dmlPairs, dmlFiles.remote);
  }else{
    if(dmlFiles.changed.length > 0){
      // unchanged ddl, changed dmls
      console.log(`Need to refresh types for ${dmlFiles.changed.length.toString().yellow.bold} of ${dmlFiles.remote.length.toString().green.bold}` + ` DMLs`.bold + ` with ${ddlFiles.deleted.length > 0 
          || ddlFiles.changed.length > 0 ? 'CHANGED'.green.bold : 'UNCHANGED'.green.bold}` +` DDL`.bold);
  
      const ddls = (await Promise.allSettled(ddlFiles.remote.map(fh => fs.readFile(
          ddlPathIsDirectory 
            ? path.resolve(params.ddl, fh.file)
            : path.resolve(params.ddl)
        ))))
        .map(p => p.status === 'fulfilled' ? p.value.toString() : null);
  
      if(ddls.includes(null)){
        console.error('Some local DDL source files are unavalible'.red.bold);
        process.exit(1);
      }
      
      const dmls = (await Promise.allSettled(dmlFiles.changed.flatMap(fh => [
        spawnChild('git', ['cat-file', 'blob', fh.hash]),
        fs.readFile(
          dmlPathIsDirectory 
            ? path.resolve(params.dml, fh.file)
            : path.resolve(params.dml),
        )
        ]
      )))
      .map(p => p.status === 'fulfilled' ? p.value.toString() : null);
  
      if(dmls.includes(null)){
        console.error('Some local DML source files are unavalible'.red.bold);
        process.exit(1);
      }
  
      const response = await callApi(params.apikey, params.db, { ddl: ddls.join(';'), dmls });


      const dmlPairs = response.data.data.compiled.dmls.reduce((accum, current, id) => {
        if(id % 2 === 0){
          return [...accum, { old: current[0], new: null}];
        }
        const last = accum.slice(-1)[0];
        last.new = current[0];
        return [...accum.slice(0, -1),  last];
      }, []);

      exitCode = assertPairs(dmlPairs, dmlFiles.changed);   
    }

    console.log('\n== PARSERS.DEV type check finished ==\n'.bold);
    process.exit(exitCode);

  }
}

module.exports = { check }