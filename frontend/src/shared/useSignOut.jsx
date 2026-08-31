import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "./components/Modal";
import { signOut } from "./createApi";

/**
 * Ask before signing out.
 *
 * Every panel offers the same three doors out — the topbar button, the Logout
 * item in the sidebar, and the button on the profile page — and all three used
 * to end the session on the first click. The topbar one sits a few pixels from
 * the notification bell, which is a bad place for an action that cannot be
 * undone by clicking again.
 *
 * The hook exists so the question is asked in one place rather than eight. It
 * hands back the function to call instead of signing out, and the dialog to
 * render; a caller that forgets the second gets a button that does nothing,
 * which is loud enough to notice.
 *
 *   const { askSignOut, signOutDialog } = useSignOut({ ... });
 *   <Button onClick={askSignOut}>Logout</Button>
 *   {signOutDialog}
 */
export default function useSignOut({ tokenKey, userKey, loginPath, panel = "" }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);

  const confirm = () => {
    setAsking(false);
    signOut(tokenKey, userKey);
    navigate(loginPath, { replace: true });
  };

  const signOutDialog = (
    <ConfirmDialog
      open={asking}
      title="Sign out?"
      message={`You will be signed out of ${
        panel || "this panel"
      } and will need your email and password to get back in. Anything you have left unsaved stays unsaved.`}
      confirmLabel="Sign out"
      // Not "danger": leaving is ordinary, and painting it red next to the
      // delete buttons that really are dangerous would flatten the difference.
      variant="primary"
      onConfirm={confirm}
      onClose={() => setAsking(false)}
    />
  );

  return { askSignOut: () => setAsking(true), signOutDialog };
}
