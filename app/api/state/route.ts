import { getChatGPTUser } from '../../chatgpt-auth';
import { readWorkspace, writeWorkspace, validateState } from '../../../lib/workbench-state';

export const dynamic = 'force-dynamic';
const result = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export async function GET() {
  if (!await getChatGPTUser()) return result({error:'AUTH_REQUIRED'},401);
  return result(await readWorkspace());
}

export async function PUT(request:Request) {
  if (!await getChatGPTUser()) return result({error:'AUTH_REQUIRED'},401);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return result({error:'ORIGIN_REQUIRED'},403);
  if (Number(request.headers.get('content-length')) > 1600000) return result({error:'TOO_LARGE'},413);
  let body:{state:unknown;revision:number};
  try {body=await request.json() as typeof body;} catch {return result({error:'INVALID_JSON'},400);}
  if (!body || typeof body !== 'object') return result({error:'INVALID_STATE'},400);
  if (!validateState(body.state) || !Number.isInteger(body.revision) || body.revision < 0) return result({error:'INVALID_STATE'},400);
  try {return result(await writeWorkspace(body.state,body.revision));}
  catch (error) {if ((error as Error).message === 'CONFLICT') return result({error:'CONFLICT',message:'数据已更新，请刷新后再操作。'},409); throw error;}
}
