/**
 * Standardized inline feedback banner for authentication forms.
 */
export function AuthAlert({
  tone = 'danger',
  message,
}: {
  tone?: 'danger' | 'success';
  message: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`p-3 text-xs rounded-[var(--radius-md)] border ${
        tone === 'danger' ? 'badge-danger' : 'badge-success'
      }`}
    >
      {message}
    </div>
  );
}
