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
        return $this->conn->query($sql);
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