using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text;
using System.Net.WebSockets;
using System;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CorrectProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public CorrectProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Получаем список вкладок
                var tabsResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json");
                var tabsJson = await tabsResponse.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<JsonElement[]>(tabsJson);

                if (tabs == null || tabs.Length == 0)
                {
                    return StatusCode(500, "No Chrome tabs available");
                }

                // Используем первую вкладку
                var tab = tabs[0];
                var webSocketUrl = tab.GetProperty("webSocketDebuggerUrl").GetString();

                if (string.IsNullOrEmpty(webSocketUrl))
                {
                    return StatusCode(500, "No WebSocket URL available");
                }

                // Подключаемся к WebSocket
                using var webSocket = new ClientWebSocket();
                await webSocket.ConnectAsync(new Uri(webSocketUrl), CancellationToken.None);

                // Отправляем команду навигации
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url
                    }
                };

                var commandJson = JsonSerializer.Serialize(navigateCommand);
                var commandBytes = Encoding.UTF8.GetBytes(commandJson);
                await webSocket.SendAsync(new ArraySegment<byte>(commandBytes), WebSocketMessageType.Text, true, CancellationToken.None);

                // Ждем загрузки
                await Task.Delay(5000);

                // Получаем HTML
                var htmlCommand = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var htmlCommandJson = JsonSerializer.Serialize(htmlCommand);
                var htmlCommandBytes = Encoding.UTF8.GetBytes(htmlCommandJson);
                await webSocket.SendAsync(new ArraySegment<byte>(htmlCommandBytes), WebSocketMessageType.Text, true, CancellationToken.None);

                // Получаем ответ - ждем несколько ответов
                var html = "";
                var buffer = new byte[1024 * 1024]; // 1MB buffer
                
                // Ждем ответы от WebSocket
                for (int i = 0; i < 10; i++) // Максимум 10 попыток
                {
                    var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    var responseJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var response = JsonSerializer.Deserialize<JsonElement>(responseJson);

                    // Проверяем, есть ли результат с HTML
                    if (response.TryGetProperty("result", out var resultElement) && 
                        resultElement.TryGetProperty("value", out var valueElement))
                    {
                        html = valueElement.GetString() ?? "";
                        if (!string.IsNullOrEmpty(html))
                        {
                            break; // Нашли HTML, выходим из цикла
                        }
                    }
                    
                    // Небольшая задержка между попытками
                    await Task.Delay(500);
                }

                await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = html,
                    timestamp = DateTime.UtcNow,
                    method = "websocket"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
