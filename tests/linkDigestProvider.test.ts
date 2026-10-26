import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShortVideoLink } from '../electron/services/videoParser';
import { parseLinkDigestResponse, readLinkDigest } from '../electron/services/linkDigestProvider';

// 全部为协议样本；不访问真实厂商，不产生商业调用。
const link = 'https://v.douyin.com/fixture/';
const fixture = { platform:'douyin',title:'视频标题',author:'作者',caption:'完整发布正文',
  transcript:[{t:0,text:'第一句原始口播'},{t:2.5,text:'第二句原始口播'}],transcript_source:'asr',duration_seconds:18,read_seconds:18,
  images:[],ocr_text:['画面文字'],on_screen:[{t:3,text:'屏幕数字 2026'}],key_points:['AI 摘要，不是口播'],
  coverage:{seconds_transcribed:18,duration_seconds:18,images_read:0,images_total:0,not_captured:[]},degraded:[],credits:2,cached:false };

test('LinkDigest 同步响应分别保留原始正文、时间片段、OCR 和消耗，不将摘要当作口播', () => {
  const result = parseLinkDigestResponse(fixture,'douyin',link);
  assert.equal(result.success,true); assert.equal(result.data?.publishedText,fixture.caption);
  assert.equal(result.data?.transcript,'第一句原始口播\n第二句原始口播'); assert.equal(result.data?.transcriptionStatus,'succeeded');
  assert.equal(result.data?.visualSummary,''); assert.equal(result.data?.durationSec,18);
  assert.deepEqual(result.data?.extractionDetails?.transcriptSegments,fixture.transcript);
  assert.deepEqual(result.data?.extractionDetails?.onScreen,fixture.on_screen);
  assert.equal(result.data?.extractionDetails?.credits,2); assert.equal(result.data?.extractionDetails?.cached,false);
});

test('LinkDigest 202 只轮询同一任务一次提交，忽略不可信 poll 地址并保留小红书分享参数', async () => {
  const original = globalThis.fetch;
  const requests: {url:string;init?:RequestInit}[] = [];
  globalThis.fetch = async (input,init) => {
    requests.push({url:String(input),init});
    if(requests.length === 1) return new Response(JSON.stringify({pending:true,jobId:'fixture_job-1',poll:'https://evil.example/steal'}),{status:202});
    if(requests.length === 2) return new Response(JSON.stringify({pending:true}),{status:202});
    return new Response(JSON.stringify({...fixture,platform:'xiaohongshu'}));
  };
  try {
    const url = 'https://www.xiaohongshu.com/explore/fixture?xsec_token=share-token&xsec_source=app_share';
    const result = await parseShortVideoLink({rawInput:url,apiProvider:'linkdigest',apiKey:'fixture-secret',linkDigestMaxCredits:7,enableMockFallback:false});
    assert.equal(result.success,true); assert.equal(requests.length,3);
    assert.equal(requests[0].url,'https://linkdigest.dev/api/v1/digest');
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)),{url,format:'json',depth:'full',partial_ok:false,max_credits:7});
    assert.equal(requests.filter(r=>r.init?.method==='POST').length,1);
    for(const request of requests){
      assert.equal(new Headers(request.init?.headers).get('Authorization'),'Bearer fixture-secret');
      assert.equal(request.init?.redirect,'error'); assert.ok(request.init?.signal);
    }
    for(const request of requests.slice(1)){
      assert.equal(request.url,'https://linkdigest.dev/api/v1/digest/fixture_job-1?wait=20');
      assert.equal(request.init?.method,'GET'); assert.equal(request.init?.body,undefined);
    }
  } finally {globalThis.fetch=original;}
});

test('LinkDigest HTTP 错误不重复计费提交，也不回显供应商错误正文中的密钥', async () => {
  const original = globalThis.fetch;
  try {
    for(const status of [400,401,402,403,422,429,502,503]){
      let calls=0;
      globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({message:'fixture-secret',error_code:'platform_refused'}),{status});};
      const errors:any[]=[];
      const result=await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'},error=>errors.push(error));
      assert.equal(result.success,false);assert.equal(calls,1);assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
      assert.equal(errors[0].status,status);assert.equal(result.isMockData,undefined);
      if(status===503)assert.match(result.errorMessage!,/平台.*拒绝/);
    }
  }finally{globalThis.fetch=original;}
});

test('LinkDigest 图片空项保留原位，完整性缺失和部分读取不标记口播完整成功', () => {
  const result=parseLinkDigestResponse({...fixture,partial:{read_seconds:8},read_seconds:8,
    images:[{ocr:'图一',description:'第一张'},null,{ocr:'图三',description:'第三张'}],
    coverage:{...fixture.coverage,images_read:2,images_total:3},degraded:['private-upstream-detail']},'douyin',link);
  assert.equal(result.success,true);assert.equal(result.data?.transcriptionStatus,'partial');
  assert.equal(result.data?.transcript,fixture.transcript.map(s=>s.text).join('\n'));
  assert.deepEqual(result.data?.extractionDetails?.images,[{ocr:'图一',description:'第一张'},{ocr:'',description:''},{ocr:'图三',description:'第三张'}]);
  assert.ok(result.data!.extractionDetails!.warnings.length>=3);
  assert.equal(JSON.stringify(result).includes('private-upstream-detail'),false);
  const legacy=parseLinkDigestResponse({...fixture,coverage:undefined},'douyin',link);
  assert.equal(legacy.data?.transcriptionStatus,'partial');
});

test('LinkDigest 图文可编辑但不伪造口播，摘要、错误和错误平台响应不能当作原稿', () => {
  const imageResult=parseLinkDigestResponse({...fixture,platform:'xiaohongshu',transcript:[],duration_seconds:undefined,read_seconds:undefined,
    images:[{ocr:'笔记图片文字',description:'图片描述'}],coverage:{images_read:1,images_total:1}},'xiaohongshu','https://xhslink.cn/fixture/');
  assert.equal(imageResult.success,true);assert.equal(imageResult.data?.transcript,'');assert.equal(imageResult.data?.transcriptionStatus,'empty');
  for(const payload of [null,{key_points:['摘要']},{...fixture,platform:'youtube'},{...fixture,error:'fixture-secret'},
    {...fixture,caption:'',transcript:[],images:[],on_screen:[],ocr_text:[]}]){
    assert.equal(parseLinkDigestResponse(payload,'douyin',link).success,false);
  }
  const captionOnly=parseLinkDigestResponse({...fixture,transcript:[],images:[],ocr_text:[],on_screen:[]},'douyin',link);
  assert.equal(captionOnly.success,false);assert.equal(captionOnly.data?.publishedText,fixture.caption);
});

test('LinkDigest 无密钥、无效预算和无效任务信息不发起额外请求', async () => {
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({pending:true,jobId:'https://evil.example/'}),{status:202});};
  try{
    assert.equal((await readLinkDigest({url:link,platform:'douyin',apiKey:''})).success,false);
    for(const maxCredits of [0,1.5,1001,NaN])assert.equal((await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret',maxCredits})).success,false);
    assert.equal(calls,0);
    assert.equal((await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'})).success,false);assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test('LinkDigest 停权取消会中断轮询，不继续请求或返回原任务内容', async () => {
  const original=globalThis.fetch;const controller=new AbortController();let calls=0;
  globalThis.fetch=async()=>{calls++;controller.abort();return new Response(JSON.stringify({pending:true,jobId:'fixture'}),{status:202});};
  try{
    await assert.rejects(readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'},undefined,controller.signal),{name:'AbortError'});
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test('LinkDigest 超时不会重新提交，网络异常不会回显含凭据的错误文本', async () => {
  const original=globalThis.fetch;const originalTimeout=AbortSignal.timeout;
  try{
    AbortSignal.timeout=()=>originalTimeout(10);
    globalThis.fetch=async()=>new Response(JSON.stringify({pending:true,jobId:'fixture'}),{status:202});
    const timeout=await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'});
    assert.equal(timeout.success,false);assert.match(timeout.errorMessage!,/超时.*可能重复计费/);
    AbortSignal.timeout=originalTimeout;
    globalThis.fetch=async()=>{throw Error('fixture-secret');};
    const result=await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'});
    assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
  }finally{globalThis.fetch=original;AbortSignal.timeout=originalTimeout;}
});


test('LinkDigest 拒绝轮询期间替换任务编号，不跟随其他任务或重定向', async () => {
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({pending:true,jobId:calls===1?'first-task':'switched-task'}),{status:202});};
  try{
    const result=await readLinkDigest({url:link,platform:'douyin',apiKey:'fixture-secret'});
    assert.equal(result.success,false);assert.equal(calls,2);assert.match(result.errorMessage!,/任务信息无效/);
  }finally{globalThis.fetch=original;}
});
