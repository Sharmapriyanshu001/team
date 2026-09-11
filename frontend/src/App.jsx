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

import AdminRoute from "./admin/AdminRoute";
import AdminLayout from "./admin/layout/AdminLayout";
import { UnreadProvider as AdminUnreadProvider } from "./admin/hooks/useUnread";

import AdminDashboard from "./admin/pages/Dashboard";

import AllClients from "./admin/pages/clients/AllClients";
import AddClient from "./admin/pages/clients/AddClient";
import ClientDocuments from "./admin/pages/clients/ClientDocuments";
import AdminMeetings from "./admin/pages/clients/Meetings";
// One client seen from every department at once, and the queue of the ones
// Sales has won that Operations has not picked up
import Client360 from "./admin/pages/clients/Client360";
import HandoverQueue from "./admin/pages/clients/HandoverQueue";

// HR: leave and hiring, which had real rows in the database and no screens
import HrOverview from "./admin/pages/hr/HrOverview";
import HrLeaves from "./admin/pages/hr/Leaves";
import HrLeaveBalances from "./admin/pages/hr/LeaveBalances";
import HrLeavePolicies from "./admin/pages/hr/LeavePolicies";
import HrRecruitment from "./admin/pages/hr/Recruitment";

// The HR, Sales and Operations logins themselves
import DepartmentAccounts from "./admin/pages/DepartmentAccounts";

/**
 * Staff, department logins and clients behind one dropdown — the screen the
 * "Team & Accounts" section points at. It renders the six screens below
 * rather than reimplementing them, so both doors lead to the same room.
 */
import TeamAccounts from "./admin/pages/team/TeamAccounts";

import AllManagers from "./admin/pages/staff/AllManagers";
import AddManager from "./admin/pages/staff/AddManager";
import AllOperationsManagers from "./admin/pages/staff/AllOperationsManagers";
import AddOperationsManager from "./admin/pages/staff/AddOperationsManager";
import OperationsManagerPerformance from "./admin/pages/staff/OperationsManagerPerformance";

import AllEmployees from "./admin/pages/staff/AllEmployees";
import AddEmployee from "./admin/pages/staff/AddEmployee";
import Attendance from "./admin/pages/staff/Attendance";
import EmployeePerformance from "./admin/pages/staff/EmployeePerformance";

import AdminChangeRequests from "./admin/pages/delivery/ChangeRequests";
import AdminProjectPayments from "./admin/pages/delivery/ProjectPayments";
import AllProjects from "./admin/pages/projects/AllProjects";
import CreateProject from "./admin/pages/projects/CreateProject";
import AssignTeam from "./admin/pages/projects/AssignTeam";
import Timeline from "./admin/pages/projects/Timeline";

import DailyTasks from "./admin/pages/tasks/DailyTasks";
import AdminPendingTasks from "./admin/pages/tasks/PendingTasks";
import AdminCompletedTasks from "./admin/pages/tasks/CompletedTasks";
import TaskReviews from "./admin/pages/tasks/TaskReviews";

import AdminClientChat from "./admin/pages/chat/ClientChat";
import AdminOperationsManagerChat from "./admin/pages/chat/OperationsManagerChat";
import AdminEmployeeChat from "./admin/pages/chat/EmployeeChat";
import AdminProjectChat from "./admin/pages/chat/ProjectChat";

import AdminIssues from "./admin/pages/Issues";
import AdminFiles from "./admin/pages/files/Files";
import AdminCodeReview from "./admin/pages/code/CodeReview";
import AdminCodeShare from "./admin/pages/code/CodeShare";
import AdminCodeProjects from "./admin/pages/code/CodeProjects";
import AdminCodeRequests from "./admin/pages/code/CodeRequests";
import AdminReports from "./admin/pages/Reports";
import AdminReportChain from "./admin/pages/ReportChain";
import AdminDepartments from "./admin/pages/Departments";
import ActivityLogs from "./admin/pages/ActivityLogs";
import RolesPermissions from "./admin/pages/RolesPermissions";
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
import AdminFollowUps from "./admin/pages/crm/FollowUps";
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

/* --------------------------------------------------------------------- HR */

/**
 * HR has a panel of its own rather than a corner of the admin one, with its
 * own token and its own routes — see backend/routes/hrRoutes.js.
 */
import HrRoute from "./hr/HrRoute";
import HrLayout from "./hr/layout/HrLayout";
import { UnreadProvider as HrUnreadProvider } from "./hr/hooks/useUnread";

import HrPanelDashboard from "./hr/pages/Dashboard";
/**
 * Staff and every login HR opens, behind one dropdown — the screen the
 * "People" section points at. It renders the five screens below rather than
 * reimplementing them, so both doors lead to the same room.
 */
import HrPeople from "./hr/pages/People";
import HrPanelEmployees from "./hr/pages/Employees";
import HrPanelManagers from "./hr/pages/HrManagers";
import HrPanelAttendance from "./hr/pages/Attendance";
import HrPanelLeave from "./hr/pages/Leave";
import HrPanelLeaveBalances from "./hr/pages/LeaveBalances";
import HrPanelLeavePolicies from "./hr/pages/LeavePolicies";
/**
 * Hiring: the vacancy, the people applying for it, the rounds they sit, the
 * decisions taken, and the onboarding that ends in an employee.
 */
import HiringDashboard from "./hr/pages/hiring/Dashboard";
import HiringOpenings from "./hr/pages/hiring/JobOpenings";
import HiringOpeningDetail from "./hr/pages/hiring/OpeningDetail";
import HiringCandidates from "./hr/pages/hiring/Candidates";
import HiringInterviews from "./hr/pages/hiring/Interviews";
import HiringShortlisted from "./hr/pages/hiring/Shortlisted";
import HiringSelected from "./hr/pages/hiring/Selected";
import HiringRejected from "./hr/pages/hiring/Rejected";
import HiringOnboarding from "./hr/pages/hiring/Onboarding";
import HrPanelDocuments from "./hr/pages/Documents";
import HrPanelReports from "./hr/pages/Reports";
import HrPanelReportChain from "./hr/pages/ReportChain";
import HrPanelDepartments from "./hr/pages/Departments";
import HrPanelSettings from "./hr/pages/Settings";
import HrDepartmentManagers from "./hr/pages/DepartmentManagers";
import HrOperationsManagers from "./hr/pages/OperationsManagers";
import HrSalesManagers from "./hr/pages/SalesManagers";
import HrClientRecords from "./hr/pages/ClientRecords";
import HrIncentives from "./hr/pages/Incentives";
import HrPanelNotifications from "./hr/pages/Notifications";
import HrPanelProfile from "./hr/pages/Profile";

/* ----------------------------------------------------------- operations manager */

import LeaderRoute from "./leader/LeaderRoute";
import LeaderLayout from "./leader/layout/LeaderLayout";
import LeaderProvider from "./leader/LeaderProvider";

import LeaderDashboard from "./leader/pages/Dashboard";

import ActiveProjects from "./leader/pages/projects/ActiveProjects";
import CompletedProjects from "./leader/pages/projects/CompletedProjects";
import ProjectDetails from "./leader/pages/projects/ProjectDetails";

import TeamMembers from "./leader/pages/team/TeamMembers";
import TeamMemberDetail from "./leader/pages/team/TeamMemberDetail";
import TeamPerformance from "./leader/pages/team/TeamPerformance";

import LeaderChangeRequests from "./leader/pages/ChangeRequests";
import LeaderLeave from "./leader/pages/Leave";
import LeaderLeavePolicies from "./leader/pages/LeavePolicies";
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
import LeaderReportChain from "./leader/pages/ReportChain";
import LeaderProfile from "./leader/pages/Profile";

/* -------------------------------------------------------------- employee */

import EmployeeRoute from "./employee/EmployeeRoute";
import EmployeeLayout from "./employee/layout/EmployeeLayout";
import EmployeeProvider from "./employee/EmployeeProvider";

import EmployeeDashboard from "./employee/pages/Dashboard";
import EmployeeMyWork from "./employee/pages/MyWork";

import EmpActiveProjects from "./employee/pages/projects/ActiveProjects";
import EmpCompletedProjects from "./employee/pages/projects/CompletedProjects";
import EmpProjectDetails from "./employee/pages/projects/ProjectDetails";

import EmployeeChangeRequests from "./employee/pages/ChangeRequests";
import TodayTasks from "./employee/pages/tasks/TodayTasks";
import EmpPendingTasks from "./employee/pages/tasks/PendingTasks";
import EmpInProgressTasks from "./employee/pages/tasks/InProgressTasks";
import EmpReviewTasks from "./employee/pages/tasks/ReviewTasks";
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
import EmpReports from "./employee/pages/Reports";
import EmpCalendar from "./employee/pages/Calendar";
// Applying for leave, which lands with HR to approve or reject
import EmployeeLeave from "./employee/pages/Leave";
import EmployeeIncentive from "./employee/pages/Incentive";
import EmpNotifications from "./employee/pages/Notifications";
import EmpProfile from "./employee/pages/Profile";

/* ----------------------------------------------------------------- sales */

import SalesRoute from "./sales/SalesRoute";
import SalesLayout from "./sales/layout/SalesLayout";
import { UnreadProvider as SalesUnreadProvider } from "./sales/hooks/useUnread";

import SalesDashboard from "./sales/pages/Dashboard";
import SalesLeads from "./sales/pages/Leads";
import SalesPipeline from "./sales/pages/Pipeline";
import SalesFollowUps from "./sales/pages/FollowUps";
import SalesRequirements from "./sales/pages/Requirements";
import SalesQuotations from "./sales/pages/Quotations";
import SalesClients from "./sales/pages/Clients";
import SalesRevenue from "./sales/pages/Revenue";
import SalesTeam from "./sales/pages/Team";
import SalesTasks from "./sales/pages/Tasks";
import SalesProjects from "./sales/pages/Projects";
import SalesReports from "./sales/pages/Reports";
import SalesNotifications from "./sales/pages/Notifications";
import SalesProfile from "./sales/pages/Profile";
import SalesLeave from "./sales/pages/Leave";

/* ---------------------------------------------------------------- client */

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
import ClientRequests from "./client/pages/Requests";
import ClientMeetings from "./client/pages/Meetings";
import ClientNotifications from "./client/pages/Notifications";
import ClientProfile from "./client/pages/Profile";

/* ------------------------------------------------------------------ auth */

import Login from "./auth/Login";

export default function App() {
  return (
    <Routes>
      {/**
        * One login for everybody.
        *
        * "/" is the only address anybody needs. The server works out which
        * panel the account belongs to and this page goes there — see
        * backend/utils/panels.js, which is the same map the middleware uses,
        * so a login can never send somebody to a door that then refuses them.
        */}
      <Route path="/" element={<Login />} />

      {/**
        * The six panel logins that used to exist, kept as redirects.
        *
        * Not deleted: they are bookmarked, they are in old emails, and one of
        * them is what an expiring session used to bounce to. Sending them to
        * "/" costs nothing and means none of those go to a dead page.
        */}
      <Route path="/admin/login" element={<Navigate to="/" replace />} />
      <Route path="/hr/login" element={<Navigate to="/" replace />} />
      <Route path="/sales/login" element={<Navigate to="/" replace />} />
      <Route path="/operation-manager/login" element={<Navigate to="/" replace />} />
      <Route path="/employee/login" element={<Navigate to="/" replace />} />
      <Route path="/client/login" element={<Navigate to="/" replace />} />

      {/**
        * The Sales panel answers to both names. Its own routes live under
        * /sales and stay there; this is so the address somebody was given for
        * a "sales manager" panel lands in the right place rather than on the
        * catch-all.
        */}
      <Route path="/sales-manager" element={<Navigate to="/sales" replace />} />
      <Route path="/sales-manager/*" element={<Navigate to="/sales" replace />} />

      {/* ------------------------------------------------------- admin */}

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
            <AdminUnreadProvider>
              <AdminLayout />
            </AdminUnreadProvider>
          </AdminRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="insights/:metric" element={<InsightDetails />} />

        {/* One panel for staff, department logins and clients. The kind of
            person is a query parameter, so a particular list is still a link
            somebody can send: /admin/team?type=client */}
        <Route path="team" element={<TeamAccounts />} />

        {/* The six screens it is built from keep their own routes: the panel
            is a second door onto them, not a replacement, so every existing
            link, bookmark and redirect still lands where it always did. */}
        <Route path="clients" element={<AllClients />} />
        <Route path="clients/add" element={<AddClient />} />
        {/* Named paths ahead of ":id" so none of them is read as a client id */}
        <Route path="clients/handover" element={<HandoverQueue />} />
        <Route path="clients/documents" element={<ClientDocuments />} />
        <Route path="clients/meetings" element={<AdminMeetings />} />
        <Route path="clients/:id" element={<Client360 />} />

        {/* ------------------------------------------------------------ HR */}
        <Route path="hr" element={<HrOverview />} />
        <Route path="hr/leave" element={<HrLeaves />} />
        <Route path="hr/leave/balances" element={<HrLeaveBalances />} />
        <Route path="hr/leave/policies" element={<HrLeavePolicies />} />
        <Route path="hr/recruitment" element={<HrRecruitment />} />
        {/* The same screen as Department Accounts, pinned to Sales — because
            somebody adding a Sales Manager looks for it under Sales, not under
            a general "department accounts" list they have to filter. */}
        <Route
          path="sales/managers"
          element={
            <DepartmentAccounts
              lockedRole="sales"
              title="Sales Managers"
              subtitle="Logins for the Sales team — they sign in at /sales"
            />
          }
        />
        {/* The same screen with the form already open, so "Add Sales Manager"
            in the sidebar lands on the form rather than on a list to press a
            button on. */}
        <Route
          path="sales/managers/add"
          element={
            <DepartmentAccounts
              lockedRole="sales"
              openOnLoad
              title="Add a Sales Manager"
              subtitle="They sign in at /sales with the login you hand them"
            />
          }
        />

        <Route path="managers" element={<AllManagers />} />
        <Route path="managers/add" element={<AddManager />} />

        <Route path="operations-managers" element={<AllOperationsManagers />} />
        <Route path="operations-managers/add" element={<AddOperationsManager />} />
        <Route path="operations-managers/performance" element={<OperationsManagerPerformance />} />

        <Route path="employees" element={<AllEmployees />} />
        <Route path="employees/add" element={<AddEmployee />} />
        <Route path="employees/attendance" element={<Attendance />} />
        <Route path="employees/performance" element={<EmployeePerformance />} />

        <Route path="projects" element={<AllProjects />} />
        {/* Every client change request in the company, with its whole history. */}
        <Route path="change-requests" element={<AdminChangeRequests />} />
        {/* Administrator only — see controllers/projectPaymentController.js. */}
        <Route path="project-payments" element={<AdminProjectPayments />} />
        <Route path="projects/create" element={<CreateProject />} />
        <Route path="projects/assign-team" element={<AssignTeam />} />
        <Route path="projects/timeline" element={<Timeline />} />

        <Route path="tasks/daily" element={<DailyTasks />} />
        <Route path="tasks/pending" element={<AdminPendingTasks />} />
        <Route path="tasks/completed" element={<AdminCompletedTasks />} />
        <Route path="tasks/reviews" element={<TaskReviews />} />

        <Route path="chat/clients" element={<AdminClientChat />} />
        <Route path="chat/operations-managers" element={<AdminOperationsManagerChat />} />
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
        <Route path="crm/follow-ups" element={<AdminFollowUps />} />
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
        <Route path="reports/chain" element={<AdminReportChain />} />
        <Route path="departments" element={<AdminDepartments />} />
        <Route path="activity-logs" element={<ActivityLogs />} />
        <Route path="roles" element={<RolesPermissions />} />
        {/* Settings folded into the profile as its Company tab. The old
            address still answers so a bookmark does not dead-end */}
        <Route path="settings" element={<Navigate to="/admin/profile" replace />} />
        <Route path="profile" element={<AdminProfile />} />
      </Route>

      {/* ---------------------------------------------------------- HR */}

      <Route
        path="/hr"
        element={
          <HrRoute>
            <HrUnreadProvider>
              <HrLayout />
            </HrUnreadProvider>
          </HrRoute>
        }
      >
        <Route index element={<Navigate to="/hr/dashboard" replace />} />
        <Route path="dashboard" element={<HrPanelDashboard />} />

        {/* One panel for staff and every login HR opens. The kind of person
            is a query parameter, so a particular list is still a link
            somebody can send: /hr/people?type=operation-manager */}
        <Route path="people" element={<HrPeople />} />

        {/* The five screens it is built from keep their own routes: the panel
            is a second door onto them, not a replacement. */}
        <Route path="employees" element={<HrPanelEmployees />} />
        <Route path="managers" element={<HrPanelManagers />} />
        <Route path="department-managers" element={<HrDepartmentManagers />} />
        <Route path="operations-managers" element={<HrOperationsManagers />} />
        <Route path="sales-managers" element={<HrSalesManagers />} />
        <Route path="client-records" element={<HrClientRecords />} />
        <Route path="incentives" element={<HrIncentives />} />
        <Route path="documents" element={<HrPanelDocuments />} />

        <Route path="attendance" element={<HrPanelAttendance />} />
        {/* Named sub-paths before the bare one so neither is swallowed */}
        <Route path="leave/balances" element={<HrPanelLeaveBalances />} />
        <Route path="leave/policies" element={<HrPanelLeavePolicies />} />
        <Route path="leave" element={<HrPanelLeave />} />

        {/* ------------------------------------------------------ hiring */}
        <Route path="hiring" element={<Navigate to="/hr/hiring/dashboard" replace />} />
        <Route path="hiring/dashboard" element={<HiringDashboard />} />
        {/* Named sub-paths before ":id" so neither is read as an opening id */}
        <Route path="hiring/openings" element={<HiringOpenings />} />
        <Route path="hiring/openings/:id" element={<HiringOpeningDetail />} />
        <Route path="hiring/candidates" element={<HiringCandidates />} />
        <Route path="hiring/interviews" element={<HiringInterviews />} />
        <Route path="hiring/shortlisted" element={<HiringShortlisted />} />
        <Route path="hiring/selected" element={<HiringSelected />} />
        <Route path="hiring/rejected" element={<HiringRejected />} />
        <Route path="hiring/onboarding" element={<HiringOnboarding />} />

        {/* The two paths Hiring replaced, kept so an open tab or a bookmark
            from before this section existed still lands somewhere sensible */}
        <Route path="recruitment" element={<Navigate to="/hr/hiring/dashboard" replace />} />
        <Route path="candidates" element={<Navigate to="/hr/hiring/candidates" replace />} />

        <Route path="reports" element={<HrPanelReports />} />
        <Route path="report-chain" element={<HrPanelReportChain />} />
        <Route path="departments" element={<HrPanelDepartments />} />
        <Route path="settings" element={<HrPanelSettings />} />
        <Route path="notifications" element={<HrPanelNotifications />} />
        <Route path="profile" element={<HrPanelProfile />} />
      </Route>

      {/* ------------------------------------------------- operations manager */}

      <Route
        path="/operation-manager/code-projects/:id/workspace"
        element={
          <LeaderRoute>
            <WorkspaceBoundary backTo="/operation-manager/code-projects">
              <Suspense fallback={<WorkspaceFallback />}>
                <LeaderWorkspace />
              </Suspense>
            </WorkspaceBoundary>
          </LeaderRoute>
        }
      />

      <Route
        path="/operation-manager"
        element={
          <LeaderRoute>
            <LeaderProvider>
              <LeaderLayout />
            </LeaderProvider>
          </LeaderRoute>
        }
      >
        <Route index element={<Navigate to="/operation-manager/dashboard" replace />} />
        <Route path="dashboard" element={<LeaderDashboard />} />

        <Route path="projects/active" element={<ActiveProjects />} />
        <Route path="projects/completed" element={<CompletedProjects />} />
        <Route path="projects/details" element={<ProjectDetails />} />

        <Route path="team" element={<TeamMembers />} />
        <Route path="team/member" element={<TeamMemberDetail />} />
        <Route path="team/performance" element={<TeamPerformance />} />

        <Route path="tasks/create" element={<CreateTask />} />
        <Route path="tasks/assigned" element={<AssignedTasks />} />

        {/* Client changes on the projects this manager runs. */}
        <Route path="change-requests" element={<LeaderChangeRequests />} />
        {/* Read-only. Writing policy is HR's — the leader router mounts only
            the GET, so there is nothing here to refuse. */}
        <Route path="leave-policies" element={<LeaderLeavePolicies />} />
        <Route path="leave" element={<LeaderLeave />} />
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
        <Route path="reports" element={<LeaderReports />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="seo" element={<LeaderSeoWork />} />
        <Route path="my-team" element={<LeaderMyTeam />} />
        <Route path="ads" element={<LeaderAdsWork />} />
        <Route path="ads/:id" element={<LeaderAdAccount />} />
        <Route path="vault" element={<LeaderVault />} />
        <Route path="play" element={<LeaderPlayApps />} />
        <Route path="play/:id" element={<LeaderPlayAppDetail />} />

        <Route path="notifications" element={<Notifications />} />
        <Route path="report-chain" element={<LeaderReportChain />} />
        <Route path="profile" element={<LeaderProfile />} />
      </Route>

      {/* ---------------------------------------------------- employee */}

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
        <Route path="projects/details" element={<EmpProjectDetails />} />

        <Route path="tasks/today" element={<TodayTasks />} />
        <Route path="tasks/pending" element={<EmpPendingTasks />} />
        <Route path="tasks/in-progress" element={<EmpInProgressTasks />} />
        <Route path="tasks/review" element={<EmpReviewTasks />} />
        <Route path="tasks/completed" element={<EmpCompletedTasks />} />
        <Route path="tasks/details" element={<TaskDetails />} />

        {/* Client changes on the projects this employee is on. */}
        <Route path="change-requests" element={<EmployeeChangeRequests />} />

        <Route path="daily-work" element={<DailyWork />} />
        <Route path="submit-work" element={<SubmitWork />} />
        <Route path="history" element={<WorkHistory />} />
        <Route path="files" element={<EmpFiles />} />
        <Route path="code" element={<EmpMyCode />} />
        <Route path="code/shared" element={<EmpSharedCode />} />
        <Route path="code-share" element={<EmpCodeShare />} />
        <Route path="code-projects" element={<EmpMyCodeProjects />} />

        <Route path="chat/operation-manager" element={<EmpLeaderChat />} />
        <Route path="chat/admin" element={<EmpAdminChat />} />
        <Route path="chat/clients" element={<EmpClientChat />} />

        <Route path="issues" element={<EmpIssues />} />
        <Route path="reports" element={<EmpReports />} />
        <Route path="calendar" element={<EmpCalendar />} />
        <Route path="leave" element={<EmployeeLeave />} />
        <Route path="incentive" element={<EmployeeIncentive />} />
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

      {/* ------------------------------------------------------- sales */}

      <Route
        path="/sales"
        element={
          <SalesRoute>
            <SalesUnreadProvider>
              <SalesLayout />
            </SalesUnreadProvider>
          </SalesRoute>
        }
      >
        <Route index element={<Navigate to="/sales/dashboard" replace />} />
        <Route path="dashboard" element={<SalesDashboard />} />

        <Route path="leads" element={<SalesLeads />} />
        <Route path="pipeline" element={<SalesPipeline />} />
        <Route path="followups" element={<SalesFollowUps />} />

        <Route path="requirements" element={<SalesRequirements />} />
        <Route path="quotations" element={<SalesQuotations />} />
        <Route path="clients" element={<SalesClients />} />
        <Route path="revenue" element={<SalesRevenue />} />

        <Route path="team" element={<SalesTeam />} />
        <Route path="tasks" element={<SalesTasks />} />
        {/* What Sales sold, and who in Operations is building it. */}
        <Route path="projects" element={<SalesProjects />} />
        <Route path="reports" element={<SalesReports />} />

        <Route path="notifications" element={<SalesNotifications />} />
        <Route path="leave" element={<SalesLeave />} />
        <Route path="profile" element={<SalesProfile />} />
      </Route>

      {/* ------------------------------------------------------ client */}

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
        <Route path="chat/operation-manager" element={<ClientLeaderChat />} />
        <Route path="chat/employees" element={<ClientEmployeeChat />} />

        {/* Raise a change, and follow exactly what the team does with it. */}
        <Route path="requests" element={<ClientRequests />} />

        <Route path="feedback" element={<ClientFeedback />} />
        <Route path="meetings" element={<ClientMeetings />} />
        <Route path="notifications" element={<ClientNotifications />} />
        <Route path="profile" element={<ClientProfile />} />
      </Route>

      {/* Anything else lands on the one login, which sends a signed-in
          browser straight back out to its own panel. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
