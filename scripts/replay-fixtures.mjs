import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {simulate}=await server.ssrLoadModule('/src/match.ts');
 await mkdir('tests/fixtures',{recursive:true});
 for(const seed of [782,79])await writeFile(`tests/fixtures/match-${seed}.json`,JSON.stringify(simulate(['Greedy','Random'],seed)));
}finally{await server.close();}
