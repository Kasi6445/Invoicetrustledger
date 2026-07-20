import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) { console.error('Portal crashed:', error, info); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="wrap">
        <div className="rejected">
          <div className="headline">Something went wrong in the portal</div>
          <div className="ledger-says">{String(this.state.error?.message || this.state.error)}</div>
        </div>
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
}
