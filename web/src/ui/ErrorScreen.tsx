interface ErrorScreenProps {
  message: string;
}

export function ErrorScreen({ message }: ErrorScreenProps) {
  return (
    <main className="screen screen--error">
      <h1 className="title title--small">Something went wrong</h1>
      <p role="alert">{message}</p>
      <p>Try reloading the page. If it keeps happening, the question bank needs attention.</p>
      <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </main>
  );
}
