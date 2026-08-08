import { Component } from 'react'
import { reportClientError } from '../data/errors.js'

/**
 * The last line of defence. Without one of these, a single thrown error inside
 * any screen unmounts the whole app and leaves a white page — on a till, mid
 * queue, with no explanation and nothing to press.
 *
 * What it shows matters as much as that it catches. The cashier's first worry
 * is whether the morning's takings just vanished, so that is the first thing
 * answered: they did not. Sales are written to the device the instant they are
 * rung up and sync on their own.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    reportClientError(error, 'render')
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="page">
        <div className="card">
          <h2>Something went wrong on this screen</h2>
          <p className="muted">
            Nothing has been lost. Every sale is saved on the tablet as it is rung up, and syncs on
            its own. The owner has been told.
          </p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Start again
          </button>
          <p className="muted small" style={{ marginBottom: 0 }}>
            If it happens again, sell on paper and tell the owner — the takings can be entered
            afterwards.
          </p>
        </div>
      </div>
    )
  }
}
