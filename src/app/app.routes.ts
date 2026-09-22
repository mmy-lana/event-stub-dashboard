import { Routes } from '@angular/router';

import { DashboardShellComponent } from './core/layout/dashboard-shell.component';

/**
 * Application routes.
 *
 * Every feature screen renders inside the dashboard shell so the header, live sync
 * badge and mobile dock persist across navigation. Feature screens are lazily
 * loaded; the design-system gallery sits outside the shell because it is a
 * standalone reference surface.
 */
export const routes: Routes = [
  {
    path: '',
    component: DashboardShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Event overview · StubDeck',
        loadComponent: () =>
          import('./features/dashboard/event-dashboard.component').then(
            (m) => m.EventDashboardComponent
          )
      },
      {
        path: 'attendees',
        title: 'Attendee roster · StubDeck',
        loadComponent: () =>
          import('./features/attendees/attendee-roster.component').then(
            (m) => m.AttendeeRosterComponent
          )
      },
      {
        path: 'terminal',
        title: 'Check-in terminal · StubDeck',
        loadComponent: () =>
          import('./features/terminal/check-in-terminal.component').then(
            (m) => m.CheckInTerminalComponent
          )
      },
      {
        // `ticketId` is bound straight into the component input by
        // `withComponentInputBinding()` (see app.config.ts).
        path: 'tickets/:ticketId',
        title: 'Ticket pass · StubDeck',
        loadComponent: () =>
          import('./features/ticketing/ticket-detail-sheet.component').then(
            (m) => m.TicketDetailSheetComponent
          )
      }
    ]
  },
  {
    path: 'gallery',
    title: 'Design system · StubDeck',
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
