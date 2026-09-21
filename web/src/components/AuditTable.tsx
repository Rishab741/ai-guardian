import type { AuditLog } from "@/lib/types";
import { StatusBadge } from "@/components/Badge";

export function AuditTable({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return <div className="px-4 py-8 text-center text-[12.5px] text-[var(--text-muted)]">No audit activity yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-[var(--border-hairline)] text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="py-2 pr-2 font-medium">Time</th>
            <th className="py-2 pr-2 font-medium">Dept.</th>
            <th className="py-2 pr-2 font-medium">Prompt (redacted)</th>
            <th className="py-2 pr-2 font-medium">PII</th>
            <th className="py-2 pr-2 font-medium text-right">Cost</th>
            <th className="py-2 pl-2 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--surface-1)]">
              <td className="py-2 pr-2 tabular text-[var(--text-muted)] whitespace-nowrap">
                {new Date(log.ts).toLocaleString(undefined, { day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="py-2 pr-2 text-[var(--text-secondary)] whitespace-nowrap">{log.department_label.split(" ")[0]}</td>
              <td className="py-2 pr-2 max-w-[160px] truncate text-[var(--text-primary)]" title={log.prompt_redacted}>
                {log.prompt_redacted}
              </td>
              <td className="py-2 pr-2">
                {log.pii_types.length === 0 ? (
                  <span className="text-[var(--text-muted)]">&mdash;</span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-secondary)]"
                    title={log.pii_types.join(", ")}
                  >
                    {log.pii_types.length}&times;
                  </span>
                )}
              </td>
              <td className="tabular py-2 pr-2 text-right whitespace-nowrap text-[var(--text-secondary)]">${log.cost_usd.toFixed(4)}</td>
              <td className="py-2 pl-2 whitespace-nowrap">
                {log.policy_allowed ? (
                  <StatusBadge status="good">{log.cache_hit ? "Cache" : log.model_used}</StatusBadge>
                ) : (
                  <StatusBadge status="critical">Blocked</StatusBadge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
