/** "No future / Future" switch: whether planned trips are part of the map and statistics. */
export function FutureSwitch({ showFuture, hasPlanned, onShowFuture }: { showFuture: boolean; hasPlanned: boolean; onShowFuture: (on: boolean) => void }) {
  return (
    <label className={`future-switch${hasPlanned ? '' : ' disabled'}`} title={hasPlanned ? 'Include planned trips' : 'Add planned trips under “Edit trips” first'}>
      <span className={showFuture ? undefined : 'active'}>No future</span>
      <input type="checkbox" role="switch" checked={showFuture} disabled={!hasPlanned} onChange={(e) => onShowFuture(e.target.checked)} aria-label="Include planned trips" />
      <span className="switch" aria-hidden />
      <span className={showFuture ? 'active' : undefined}>Future</span>
    </label>
  );
}
