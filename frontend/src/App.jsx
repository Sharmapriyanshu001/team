import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/* -------------------------------------------------------------- workspace */

/**
 * The code workspace carries Monaco, which is several megabytes. Loading it
 * lazily keeps that weight in its own chunk, so the dashboard, the task lists
 * and every other screen stay exactly as light as they were.
 */
import WorkspaceBoundary from "./shared/workspace/WorkspaceBoundary";

const AdminWorkspace = lazy(() => import("./admin/pages/code/WorkspacePage"));
const LeaderWorkspace = lazy(() => import("./leader/pages/WorkspacePage"));
const EmployeeWorkspace = lazy(() => import("./employee/pages/WorkspacePage"));

const WorkspaceFallback = () => (
  <div className="flex h-screen items-center justify-center bg-[#0B0F1A] text-sm text-slate-400">
    Loading workspace…
  </div>
);

/* ------------------------------------------------------------------ admin */

import AdminLogin from "./admin/AdminLogin";
import AdminRoute from "./admin/AdminRoute";
import AdminLayout from "./admin/layout/AdminLayout";

import AdminDashboard from "./admin/pages/Dashboard";

import AllClients from "./admin/pages/clients/AllClients";
import AddClient from "./admin/pages/clients/AddClient";
import ClientDocuments from "./admin/pages/clients/ClientDocuments";
import AdminMeetings from "./admin/pages/clients/Meetings";

import AllTeamLeaders from "./admin/pages/staff/AllTeamLeaders";
import AddTeamLeader from "./admin/pages/staff/AddTeamLeader";
import TeamLeaderPerformance from "./admin/pages/staff/TeamLeaderPerformance";

import AllEmployees from "./admin/pages/staff/AllEmployees";
import AddEmployee from "./admin/pages/staff/AddEmployee";
import Attendance from "./admin/pages/staff/Attendance";
import EmployeePerformance from "./admin/pages/staff/EmployeePerformance";

import AllProjects from "./admin/pages/projects/AllProjects";
import CreateProject from "./admin/pages/projects/CreateProject";
import AssignTeam from "./admin/pages/projects/AssignTeam";
import Timeline from "./admin/pages/projects/Timeline";

import DailyTasks from "./admin/pages/tasks/DailyTasks";
import AdminPendingTasks from "./admin/pages/tasks/PendingTasks";
import AdminCompletedTasks from "./admin/pages/tasks/CompletedTasks";
import TaskReviews from "./admin/pages/tasks/TaskReviews";

import AdminClientChat from "./admin/pages/chat/ClientChat";
import AdminTeamLeaderChat from "./admin/pages/chat/TeamLeaderChat";
import AdminEmployeeChat from "./admin/pages/chat/EmployeeChat";
import AdminProjectChat from "./admin/pages/chat/ProjectChat";

import AdminIssues from "./admin/pages/Issues";
import AdminFiles from "./admin/pages/files/Files";
import AdminCodeReview from "./admin/pages/code/CodeReview";
import AdminCodeShare from "./admin/pages/code/CodeShare";
import AdminCodeProjects from "./admin/pages/code/CodeProjects";
import AdminCodeRequests from "./admin/pages/code/CodeRequests";
import AdminReports from "./admin/pages/Reports";
import ActivityLogs from "./admin/pages/ActivityLogs";
import RolesPermissions from "./admin/pages/RolesPermissions";
import Settings from "./admin/pages/Settings";
import AdminProfile from "./admin/pages/Profile";
import LeaderPlayApps from "./leader/pages/PlayApps";
import LeaderPlayAppDetail from "./leader/pages/PlayAppDetail";
import EmpPlayApps from "./employee/pages/PlayApps";
import EmpPlayAppDetail from "./employee/pages/PlayAppDetail";

import AdminTeams from "./admin/pages/teams/Teams";
import AdminTeamDetail from "./admin/pages/teams/TeamDetail";
import LeaderMyTeam from "./leader/pages/MyTeamPage";
import EmpMyTeam from "./employee/pages/MyTeamPage";

import AdminPortfolio from "./admin/pages/portfolio/Portfolio";
import AdminPropertyDetail from "./admin/pages/portfolio/PropertyDetail";

import AdminAdAccounts from "./admin/pages/ads/Accounts";
import AdminAdAccountDetail from "./admin/pages/ads/AccountDetail";
import AdminAdReport from "./admin/pages/ads/Report";
import LeaderAdsWork from "./leader/pages/AdsWork";
import LeaderAdAccount from "./leader/pages/AdAccountPage";
import EmpAdsWork from "./employee/pages/AdsWork";
import EmpAdAccount from "./employee/pages/AdAccountPage";

import AdminLeads from "./admin/pages/crm/Leads";
import AdminQuotations from "./admin/pages/crm/Quotations";
import AdminInvoices from "./admin/pages/crm/Invoices";
import AdminInvoiceDetail from "./admin/pages/crm/InvoiceDetail";
import AdminVault from "./admin/pages/vault/Vault";
import LeaderVault from "./leader/pages/VaultPage";
import EmpVault from "./employee/pages/VaultPage";

import AdminSeoEngagements from "./admin/pages/seo/Engagements";
import AdminSeoDetail from "./admin/pages/seo/EngagementDetail";
import AdminSeoReport from "./admin/pages/seo/Report";
import AdminSeoSocial from "./admin/pages/seo/Social";
import LeaderSeoWork from "./leader/pages/SeoWork";
import EmpSeoWork from "./employee/pages/SeoWork";

import AdminPlayConsoles from "./admin/pages/play/Consoles";
import AdminPlayApps from "./admin/pages/play/Apps";
import AdminPlayAppDetail from "./admin/pages/play/AppDetail";
import AdminPlayAlerts from "./admin/pages/play/PolicyAlerts";

import AdminNotifications from "./admin/pages/Notifications";
import InsightDetails from "./admin/pages/InsightDetails";

/* ----------------------------------------------------------- team leader */

import LeaderLogin from "./leader/LeaderLogin";
import LeaderRoute from "./leader/LeaderRoute";
import LeaderLayout from "./leader/layout/LeaderLayout";
import LeaderProvider from "./leader/LeaderProvider";

import LeaderDashboard from "./leader/pages/Dashboard";

import ActiveProjects from "./leader/pages/projects/ActiveProjects";
import CompletedProjects from "./leader/pages/projects/CompletedProjects";
import ProjectDetails from "./leader/pages/projects/ProjectDetails";

import TeamMembers from "./leader/pages/team/TeamMembers";
import TeamPerformance from "./leader/pages/team/TeamPerformance";

import CreateTask from "./leader/pages/tasks/CreateTask";
import AssignedTasks from "./leader/pages/tasks/AssignedTasks";
import LeaderPendingTasks from "./leader/pages/tasks/PendingTasks";
import LeaderCompletedTasks from "./leader/pages/tasks/CompletedTasks";

import DailyReview from "./leader/pages/DailyReview";
import ProjectProgress from "./leader/pages/ProjectProgress";
import LeaderFiles from "./leader/pages/Files";
import LeaderSharedCode from "./leader/pages/SharedCode";
import LeaderCodeReviews from "./leader/pages/CodeReviews";
import LeaderAssignWork from "./leader/pages/AssignWork";
import LeaderCodeShare from "./leader/pages/CodeShare";
import LeaderMyCodeProjects from "./leader/pages/MyCodeProjects";

import LeaderAdminChat from "./leader/pages/chat/AdminChat";
import LeaderEmployeeChat from "./leader/pages/chat/EmployeeChat";
import LeaderClientChat from "./leader/pages/chat/ClientChat";

import LeaderIssues from "./leader/pages/Issues";
import Calendar from "./leader/pages/Calendar";
import Notifications from "./leader/pages/Notifications";
import LeaderReports from "./leader/pages/Reports";
import LeaderProfile from "./leader/pages/Profile";

/* -------------------------------------------------------------- employee */

import EmployeeLogin from "./employee/EmployeeLogin";
import EmployeeRoute from "./employee/EmployeeRoute";
import EmployeeLayout from "./employee/layout/EmployeeLayout";
import EmployeeProvider from "./employee/EmployeeProvider";

import EmployeeDashboard from "./employee/pages/Dashboard";
import EmployeeMyWork from "./employee/pages/MyWork";

import EmpActiveProjects from "./employee/pages/projects/ActiveProjects";
import EmpCompletedProjects from "./employee/pages/projects/CompletedProjects";

import TodayTasks from "./employee/pages/tasks/TodayTasks";
import EmpPendingTasks from "./employee/pages/tasks/PendingTasks";
import EmpCompletedTasks from "./employee/pages/tasks/CompletedTasks";
import TaskDetails from "./employee/pages/tasks/TaskDetails";

import DailyWork from "./employee/pages/DailyWork";
import SubmitWork from "./employee/pages/SubmitWork";
import WorkHistory from "./employee/pages/WorkHistory";
import EmpFiles from "./employee/pages/Files";
import EmpMyCode from "./employee/pages/MyCode";
import EmpSharedCode from "./employee/pages/SharedCode";
import EmpCodeShare from "./employee/pages/CodeShare";
import EmpMyCodeProjects from "./employee/pages/MyCodeProjects";

import EmpLeaderChat from "./employee/pages/chat/LeaderChat";
import EmpAdminChat from "./employee/pages/chat/AdminChat";
import EmpClientChat from "./employee/pages/chat/ClientChat";

import EmpIssues from "./employee/pages/Issues";
import EmpCalendar from "./employee/pages/Calendar";
import EmpNotifications from "./employee/pages/Notifications";
import EmpProfile from "./employee/pages/Profile";

/* ---------------------------------------------------------------- client */

import ClientLogin from "./client/ClientLogin";
import ClientRoute from "./client/ClientRoute";
import ClientLayout from "./client/layout/ClientLayout";
import ClientProvider from "./client/ClientProvider";

import ClientDashboard from "./client/pages/Dashboard";
import MyProjects from "./client/pages/MyProjects";
import ClientProgress from "./client/pages/ProjectProgress";
import ClientFiles from "./client/pages/Files";
import ClientAdminChat from "./client/pages/chat/AdminChat";
import ClientLeaderChat from "./client/pages/chat/LeaderChat";
import ClientEmployeeChat from "./client/pages/chat/EmployeeChat";
import ClientFeedback from "./client/pages/Feedback";
import ClientMeetings from "./client/pages/Meetings";
import ClientNotifications from "./client/pages/Notifications";
import ClientProfile from "./client/pages/Profile";

export default function App() {
  return (
    <Routes>
      {/* ------------------------------------------------------- admin */}
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* The workspace is full screen — guarded like every other admin route,
          but deliberately outside the panel chrome so the editor gets the
          whole viewport. Lazy so Monaco never loads for anyone who does not
          open a project. */}
      <Route
        path="/admin/code-projects/:id/workspace"
        element={
          <AdminRoute>
            <WorkspaceBoundary backTo="/admin/code-projects">
              <Suspense fallback={<WorkspaceFallback />}>
                <AdminWorkspace />
              </Suspense>
            </WorkspaceBoundary>
          </AdminRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="insights/:metric" element={<InsightDetails />} />

        <Route path="clients" element={<AllClients />} />
        <Route path="clients/add" element={<AddClient />} />
        <Route path="clients/documents" element={<ClientDocuments />} />
        <Route path="clients/meetings" element={<AdminMeetings />} />

        <Route path="team-leaders" element={<AllTeamLeaders />} />
        <Route path="team-leaders/add" element={<AddTeamLeader />} />
        <Route path="team-leaders/performance" element={<TeamLeaderPerformance />} />

        <Route path="employees" element={<AllEmployees />} />
        <Route path="employees/add" element={<AddEmployee />} />
        <Route path="employees/attendance" element={<Attendance />} />
        <Route path="employees/performance" element={<EmployeePerformance />} />

        <Route path="projects" element={<AllProjects />} />
        <Route path="projects/create" element={<CreateProject />} />
        <Route path="projects/assign-team" element={<AssignTeam />} />
        <Route path="projects/timeline" element={<Timeline />} />

        <Route path="tasks/daily" element={<DailyTasks />} />
        <Route path="tasks/pending" element={<AdminPendingTasks />} />
        <Route path="tasks/completed" element={<AdminCompletedTasks />} />
        <Route path="tasks/reviews" element={<TaskReviews />} />

        <Route path="chat/clients" element={<AdminClientChat />} />
        <Route path="chat/team-leaders" element={<AdminTeamLeaderChat />} />
        <Route path="chat/employees" element={<AdminEmployeeChat />} />
        <Route path="chat/projects" element={<AdminProjectChat />} />

        <Route path="issues" element={<AdminIssues />} />
        <Route path="files" element={<AdminFiles />} />
        <Route path="code" element={<AdminCodeReview />} />
        <Route path="code-share" element={<AdminCodeShare />} />
        <Route path="code-projects" element={<AdminCodeProjects />} />
        <Route path="code-projects/requests" element={<AdminCodeRequests />} />
        <Route path="teams" element={<AdminTeams />} />
        <Route path="teams/:id" element={<AdminTeamDetail />} />

        <Route path="portfolio" element={<AdminPortfolio />} />
        <Route path="portfolio/:id" element={<AdminPropertyDetail />} />

        <Route path="ads" element={<AdminAdAccounts />} />
        <Route path="ads/:id" element={<AdminAdAccountDetail />} />
        <Route path="ads/:id/report" element={<AdminAdReport />} />

        <Route path="crm/leads" element={<AdminLeads />} />
        <Route path="crm/quotations" element={<AdminQuotations />} />
        <Route path="crm/invoices" element={<AdminInvoices />} />
        <Route path="crm/invoices/:id" element={<AdminInvoiceDetail />} />
        <Route path="vault" element={<AdminVault />} />

        <Route path="seo" element={<AdminSeoEngagements />} />
        <Route path="seo/social" element={<AdminSeoSocial />} />
        <Route path="seo/:id" element={<AdminSeoDetail />} />
        <Route path="seo/:id/report" element={<AdminSeoReport />} />

        <Route path="play/consoles" element={<AdminPlayConsoles />} />
        <Route path="play/apps" element={<AdminPlayApps />} />
        <Route path="play/apps/:id" element={<AdminPlayAppDetail />} />
        <Route path="play/alerts" element={<AdminPlayAlerts />} />

        <Route path="notifications" element={<AdminNotifications />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="activity-logs" element={<ActivityLogs />} />
        <Route path="roles" element={<RolesPermissions />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<AdminProfile />} />
      </Route>

      {/* ------------------------------------------------- team leader */}
      <Route path="/team-leader/login" element={<LeaderLogin />} />

      <Route
        path="/team-leader/code-projects/:id/workspace"
        element={
          <LeaderRoute>
            <WorkspaceBoundary backTo="/team-leader/code-projects">
              <Suspense fallback={<WorkspaceFallback />}>
                <LeaderWorkspace />
              </Suspense>
            </WorkspaceBoundary>
          </LeaderRoute>
        }
      />

      <Route
        path="/team-leader"
        element={
          <LeaderRoute>
            <LeaderProvider>
              <LeaderLayout />
            </LeaderProvider>
          </LeaderRoute>
        }
      >
        <Route index element={<Navigate to="/team-leader/dashboard" replace />} />
        <Route path="dashboard" element={<LeaderDashboard />} />

        <Route path="projects/active" element={<ActiveProjects />} />
        <Route path="projects/completed" element={<CompletedProjects />} />
        <Route path="projects/details" element={<ProjectDetails />} />

        <Route path="team" element={<TeamMembers />} />
        <Route path="team/performance" element={<TeamPerformance />} />

        <Route path="tasks/create" element={<CreateTask />} />
        <Route path="tasks/assigned" element={<AssignedTasks />} />
        <Route path="tasks/pending" element={<LeaderPendingTasks />} />
        <Route path="tasks/completed" element={<LeaderCompletedTasks />} />

        <Route path="daily-review" element={<DailyReview />} />
        <Route path="progress" element={<ProjectProgress />} />
        <Route path="files" element={<LeaderFiles />} />
        <Route path="code" element={<LeaderSharedCode />} />
        <Route path="code-reviews" element={<LeaderCodeReviews />} />
        <Route path="assign-work" element={<LeaderAssignWork />} />
        <Route path="code-share" element={<LeaderCodeShare />} />
        <Route path="code-projects" element={<LeaderMyCodeProjects />} />

        <Route path="chat/admin" element={<LeaderAdminChat />} />
        <Route path="chat/employees" element={<LeaderEmployeeChat />} />
        <Route path="chat/clients" element={<LeaderClientChat />} />

        <Route path="issues" element={<LeaderIssues />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="seo" element={<LeaderSeoWork />} />
        <Route path="my-team" element={<LeaderMyTeam />} />
        <Route path="ads" element={<LeaderAdsWork />} />
        <Route path="ads/:id" element={<LeaderAdAccount />} />
        <Route path="vault" element={<LeaderVault />} />
        <Route path="play" element={<LeaderPlayApps />} />
        <Route path="play/:id" element={<LeaderPlayAppDetail />} />

        <Route path="notifications" element={<Notifications />} />
        <Route path="reports" element={<LeaderReports />} />
        <Route path="profile" element={<LeaderProfile />} />
      </Route>

      {/* ---------------------------------------------------- employee */}
      <Route path="/employee/login" element={<EmployeeLogin />} />

      <Route
        path="/employee/code-projects/:id/workspace"
        element={
          <EmployeeRoute>
            <WorkspaceBoundary backTo="/employee/code-projects">
              <Suspense fallback={<WorkspaceFallback />}>
                <EmployeeWorkspace />
              </Suspense>
            </WorkspaceBoundary>
          </EmployeeRoute>
        }
      />

      <Route
        path="/employee"
        element={
          <EmployeeRoute>
            <EmployeeProvider>
              <EmployeeLayout />
            </EmployeeProvider>
          </EmployeeRoute>
        }
      >
        <Route index element={<Navigate to="/employee/dashboard" replace />} />
        <Route path="dashboard" element={<EmployeeDashboard />} />
        <Route path="my-work" element={<EmployeeMyWork />} />

        <Route path="projects/active" element={<EmpActiveProjects />} />
        <Route path="projects/completed" element={<EmpCompletedProjects />} />

        <Route path="tasks/today" element={<TodayTasks />} />
        <Route path="tasks/pending" element={<EmpPendingTasks />} />
        <Route path="tasks/completed" element={<EmpCompletedTasks />} />
        <Route path="tasks/details" element={<TaskDetails />} />

        <Route path="daily-work" element={<DailyWork />} />
        <Route path="submit-work" element={<SubmitWork />} />
        <Route path="history" element={<WorkHistory />} />
        <Route path="files" element={<EmpFiles />} />
        <Route path="code" element={<EmpMyCode />} />
        <Route path="code/shared" element={<EmpSharedCode />} />
        <Route path="code-share" element={<EmpCodeShare />} />
        <Route path="code-projects" element={<EmpMyCodeProjects />} />

        <Route path="chat/team-leader" element={<EmpLeaderChat />} />
        <Route path="chat/admin" element={<EmpAdminChat />} />
        <Route path="chat/clients" element={<EmpClientChat />} />

        <Route path="issues" element={<EmpIssues />} />
        <Route path="calendar" element={<EmpCalendar />} />
        <Route path="seo" element={<EmpSeoWork />} />
        <Route path="my-team" element={<EmpMyTeam />} />
        <Route path="ads" element={<EmpAdsWork />} />
        <Route path="ads/:id" element={<EmpAdAccount />} />
        <Route path="vault" element={<EmpVault />} />
        <Route path="play" element={<EmpPlayApps />} />
        <Route path="play/:id" element={<EmpPlayAppDetail />} />

        <Route path="notifications" element={<EmpNotifications />} />
        <Route path="profile" element={<EmpProfile />} />
      </Route>

      {/* ------------------------------------------------------ client */}
      <Route path="/client/login" element={<ClientLogin />} />

      <Route
        path="/client"
        element={
          <ClientRoute>
            <ClientProvider>
              <ClientLayout />
            </ClientProvider>
          </ClientRoute>
        }
      >
        <Route index element={<Navigate to="/client/dashboard" replace />} />
        <Route path="dashboard" element={<ClientDashboard />} />

        <Route path="projects" element={<MyProjects />} />
        <Route path="progress" element={<ClientProgress />} />
        <Route path="files" element={<ClientFiles />} />

        <Route path="chat/admin" element={<ClientAdminChat />} />
        <Route path="chat/team-leader" element={<ClientLeaderChat />} />
        <Route path="chat/employees" element={<ClientEmployeeChat />} />

        <Route path="feedback" element={<ClientFeedback />} />
        <Route path="meetings" element={<ClientMeetings />} />
        <Route path="notifications" element={<ClientNotifications />} />
        <Route path="profile" element={<ClientProfile />} />
      </Route>

      {/* Anything else lands on the admin login */}
      <Route path="*" element={<Navigate to="/admin/login" replace />} />
    </Routes>
  );
}
