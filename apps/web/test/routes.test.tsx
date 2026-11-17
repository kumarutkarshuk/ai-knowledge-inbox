import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../src/routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(cleanup);

describe('app routes', () => {
  it('renders the nav with Ask and Library links', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation');
    expect(screen.getByRole('link', { name: 'Ask' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Library' }).getAttribute('href')).toBe('/library');
    expect(nav.contains(screen.getByRole('link', { name: 'Ask' }))).toBe(true);
  });

  it('renders the Ask page at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Ask' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask' }).getAttribute('aria-current')).toBe('page');
  });

  it('renders the Library page at /library', () => {
    renderAt('/library');
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Ask' }).getAttribute('aria-current')).toBeNull();
  });

  it('renders the Login page at /login without the nav', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'Login' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('moves between pages with the nav links', () => {
    const router = renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(router.state.location.pathname).toBe('/library');
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
  });

  it('redirects unknown paths to /', () => {
    const router = renderAt('/does-not-exist');
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'Ask' })).toBeTruthy();
  });
});
