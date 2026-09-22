import { Routes } from '@angular/router';

/**
 * Application routes.
 *
 * The dashboard shell hosts the feature screens; its child routes are registered
 * during the page-assembly phase. The gallery route is the design-system
 * reference surface used for visual and viewport review.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./core/layout/dashboard-shell.component').then((m) => m.DashboardShellComponent)
  },
  {
    path: 'gallery',
    loadComponent: () =>
      import('./features/gallery/component-gallery.component').then(
        (m) => m.ComponentGalleryComponent
      )
  },
  {
    path: '**',
    redirectTo: ''
  }
];
