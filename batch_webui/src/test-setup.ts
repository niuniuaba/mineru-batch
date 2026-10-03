import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Explicit rather than relying on React Testing Library's auto-registration, which does
// not fire here: without it, a component rendered in one test can receive an async state
// update during the next, where the module mocks have already been reset.
afterEach(cleanup)
