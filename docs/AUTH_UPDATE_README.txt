HAMMER CRAFT AUTH UPDATE

Main flow:
  Public ACCOUNT links -> login.html
  Login -> Supabase Auth -> profiles.is_admin
  is_admin=true -> admin.html
  is_admin=false -> account.html

Files updated:
  auth.js
  login.js / login.html
  account.html + NEW customer.js
  admin.js / admin.html
  scan-admin.js / scan-admin.html
  public ACCOUNT navigation links
  account.css / admin.css warm Hammer Craft theme

Run AUTH_SETUP.sql in Supabase SQL Editor if profiles.is_admin or the self-read/self-insert policies are missing.

The browser continues to use only the publishable key in supabase-client.js.
Never place your service-role key in this website folder.
