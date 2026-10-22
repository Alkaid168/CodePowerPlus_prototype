/** Fixed UTC+8 display; stored/exported timestamps remain timezone-aware UTC. */
export function formatSubmissionTime(value){
  if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return '—';
  const time=Date.parse(value),display=time+8*60*60*1000;
  if(!Number.isFinite(time)||!Number.isFinite(new Date(display).getTime()))return '—';
  return new Date(display).toISOString().slice(0,19).replace('T',' ');
}
