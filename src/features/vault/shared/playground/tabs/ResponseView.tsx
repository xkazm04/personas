import { ResponseViewer } from '../ResponseViewer';
import type { ApiProxyResponse } from '@/api/system/apiProxy';

interface ResponseViewProps {
  response: ApiProxyResponse | null;
  sendError: string | null;
}

export function ResponseView({ response, sendError }: ResponseViewProps) {
  return (
    <>
      {(response || sendError) && (
        <div className="bg-primary/25" />
      )}

      {(response || sendError) && (
        <div className="min-w-0 pl-4">
          <span className="text-sm uppercase tracking-wider text-emerald-400/70 font-semibold block mb-3">
            Response
          </span>
          {sendError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
              {sendError}
            </div>
          )}
          {response && <ResponseViewer response={response} />}
        </div>
      )}
    </>
  );
}
