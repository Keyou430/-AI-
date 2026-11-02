import { imageTextChecks, verifyImageEvidence } from '../../../electron/services/imageTextReview';
import type { ImageTextDraft, ImageStyleCard } from '../../../electron/services/imageTextTypes';
import { useAppStore } from '../../store/useAppStore';
export function useImageTextReview(draft: ImageTextDraft | null) {
  const docs = useAppStore(s => s.knowledgeDocs);
  const keywords = useAppStore(s => s.keywords);
  const evidence = draft ? verifyImageEvidence(draft,docs) : [];
  const checks = draft ? imageTextChecks(draft,keywords.filter(k => k.category === 'forbidden').map(k => k.text)) : [];
  return { checks, evidence, warningCount: checks.filter(check => !check.passed).length };
}
export function ImageTextReviewPanel({ draft }: { draft: ImageTextDraft }) {
  const { checks, evidence, warningCount } = useImageTextReview(draft);
  return <details className="disclosure" open={warningCount > 0 ? true : undefined}><summary>依据核对与图文自查（仅提醒）</summary>
    <div className="mt-3 space-y-2 text-xs">{checks.map(c => <p key={c.id} className={c.passed ? 'text-muted-foreground' : 'text-warning'}>{c.passed ? '✓ ' : '提醒：'}{c.label} · {c.detail}</p>)}
      {!evidence.length && <p className="text-muted-foreground">本稿未声明公司事实依据；请核对是否存在无依据的参数、价格或承诺。</p>}
      {evidence.map((e,i) => <div key={i} className="rounded border p-2"><p>{e.status}：{e.claim}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">依据原文：{e.quote}</p></div>)}
    </div>
  </details>;
}
export function ImageTextStyleCardEditor({ draft, onChange, disabled = false }: { draft: ImageTextDraft; onChange: (card: ImageStyleCard) => void; disabled?: boolean }) {
  const card = draft.styleCard || { palette: '', layout: '', typography: '', elements: '', mood: draft.style };
  return <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3"><legend className="px-1 text-xs font-medium">整套风格卡</legend>
    {([['palette','色调'],['layout','版式'],['typography','字体观感'],['elements','画面元素'],['mood','氛围']] as const).map(([key,label]) => <label key={key} className="block text-xs">{label}<textarea className="field mt-1.5" rows={2} value={card[key]} onChange={e => onChange({ ...card, [key]:e.target.value })} /></label>)}
  </fieldset>;
}
