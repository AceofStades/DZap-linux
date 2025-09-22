package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "os"
)

type Command struct {
    Action string `json:"action"`
}

func main() {
    reader := bufio.NewScanner(os.Stdin)
    for reader.Scan() {
        var cmd Command
        if err := json.Unmarshal([]byte(reader.Text()), &cmd); err != nil {
            fmt.Println(`{"type":"error","message":"invalid JSON"}`)
            continue
        }

        switch cmd.Action {
        case "detect-drives":
            // TODO: Replace with real system drive detection
            drives := []map[string]string{
                {"name": "/dev/sda", "size": "256GB SSD"},
                {"name": "/dev/sdb", "size": "1TB HDD"},
            }
            out, _ := json.Marshal(map[string]interface{}{
                "type":   "drive-list",
                "drives": drives,
            })
            fmt.Println(string(out))

        case "wipe":
            // future: implement wipe
            fmt.Println(`{"type":"log","message":"Wipe started..."}`)
        }
    }
}
