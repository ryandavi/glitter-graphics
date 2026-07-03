<?php
// ============================================
// DATABASE CLASS
// ============================================
class Database
{
    private $conn;

    public function __construct($config)
    {
        $this->conn = new mysqli(
            $config['db_host'],
            $config['db_user'],
            $config['db_pass'],
            $config['db_name']
        );

        if ($this->conn->connect_error) {
            throw new Exception('Database connection failed: ' . $this->conn->connect_error);
        }
    }

    public function query($sql)
    {
        $result = $this->conn->query($sql);
        if ($result === false) {
            throw new Exception('Database query failed: ' . $this->conn->error);
        }

        return $result;
    }

    public function prepare($sql, $types = '', $params = [])
    {
        $stmt = $this->conn->prepare($sql);
        if ($stmt === false) {
            throw new Exception('Database prepare failed: ' . $this->conn->error);
        }

        if ($types !== '') {
            $bindArgs = [$types];
            foreach ($params as $index => $value) {
                $bindArgs[] = &$params[$index];
            }

            $bound = call_user_func_array([$stmt, 'bind_param'], $bindArgs);
            if ($bound === false) {
                $stmt->close();
                throw new Exception('Database bind failed: ' . $stmt->error);
            }
        }

        if (!$stmt->execute()) {
            $error = $stmt->error;
            $stmt->close();
            throw new Exception('Database execute failed: ' . $error);
        }

        return $stmt;
    }

    public function escape($str)
    {
        return $this->conn->real_escape_string($str);
    }

    public function lastInsertId()
    {
        return $this->conn->insert_id;
    }
}
?>
