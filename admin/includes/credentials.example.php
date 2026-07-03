<?php

// Copy this file to credentials.php and set a real password hash. To generate one, run:
//   php -r "echo password_hash('yourPassword', PASSWORD_BCRYPT), PHP_EOL;"
// Never store the plaintext password here.

return [
    // Set to false to bypass admin login entirely (local dev convenience).
    // Always leave this true anywhere the admin area is reachable over the network.
    'auth_enabled' => true,
    'username' => 'admin',
    'password_hash' => '$2y$10$aMomKn8NJGH.wl/YW1h7HOtOqh4qhCD/sJkDuydHfnj8klfo5Ny6a',
];
