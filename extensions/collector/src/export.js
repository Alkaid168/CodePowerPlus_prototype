import {exportBatches} from './engine.js';

export async function* collectionJsonChunks(task,recordBatches,batchSize=25){
  if(!task?.coverageScope||!recordBatches?.[Symbol.asyncIterator]||!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('invalid_export');
  yield '{"format":"codepowerplus-collection-v1","scope":'+JSON.stringify(task.coverageScope)+',"batches":[';
  let first=true;
  for await(const records of recordBatches){
    if(!Array.isArray(records)||!records.length||records.length>batchSize)throw Error('invalid_export_batch');
    for(const batch of exportBatches(task,records,batchSize)){
      yield (first?'':',')+JSON.stringify(batch);
      first=false;
    }
  }
  yield ']}';
}
