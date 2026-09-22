import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./core/layout/dashboard-shell.component').then(
        (m) => m.DashboardShellComponent
      )
  },
  {
    path: '**',
    redirectTo: ''
  }
];
